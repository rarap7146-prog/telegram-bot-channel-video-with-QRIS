require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const Database = require('./database');
const Joi = require('joi');

// --- Configuration ---
const token = process.env.TELEGRAM_BOT_TOKEN;
const USE_WEBHOOK = process.env.USE_WEBHOOK === 'true' || process.argv.includes('--webhook');
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://araska.id/bot-creator-papa/webhook';
const TECH_SUPPORT_USERNAME = process.env.TECH_SUPPORT_USERNAME || 'titokt78';
const TECH_SUPPORT_USER_ID = parseInt(process.env.TECH_SUPPORT_USER_ID) || 7761064473;
const TECH_SUPPORT_DISPLAY_NAME = process.env.TECH_SUPPORT_DISPLAY_NAME || 'papabadak';

console.log(`🚀 Starting Bot-Creator-Papa in ${USE_WEBHOOK ? 'WEBHOOK' : 'POLLING'} mode...`);

// --- Initialization ---
const bot = new TelegramBot(token, { 
    polling: !USE_WEBHOOK,
    webHook: false  // We'll set webhook manually to avoid port conflicts
});

const db = new Database();
let userSessions = new Map(); // Store user session data temporarily

// --- Validation Schemas ---
const schemas = {
    channelUsername: Joi.string().pattern(/^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/).required(),
    oyApiKey: Joi.string().min(10).max(200).required()
};

// --- Helper Functions ---
function safeHandler(fn) {
    return async function(...args) {
        const msg = args[0];
        const chatId = msg?.chat?.id || msg?.message?.chat?.id;
        try {
            await fn(...args);
        } catch (err) {
            console.error(`[HANDLER ERROR] in ${fn.name || 'anonymous_handler'}:`, err);
            if (chatId) {
                await bot.sendMessage(chatId, 
                    '❌ Terjadi kesalahan pada sistem. Tim teknis sudah diberitahu.\n\n' +
                    'Silakan coba lagi dalam beberapa menit atau hubungi @titokt78 untuk bantuan.'
                ).catch(e => console.error("Failed to send error message:", e));
            }
            
            // Log to database
            if (msg?.from?.id) {
                await db.logActivity(
                    msg.from.id, null, 'error', 
                    `Handler error: ${err.message}`, 
                    { handler: fn.name, error: err.stack }
                ).catch(() => {});
            }
        }
    };
}

async function validateChannelAccess(channelUsername) {
    try {
        // Remove @ if present
        const cleanUsername = channelUsername.startsWith('@') ? channelUsername.slice(1) : channelUsername;
        
        console.log(`[DEBUG] Checking channel access for: @${cleanUsername}`);
        
        // Try to get chat info
        const chat = await bot.getChat(`@${cleanUsername}`);
        console.log(`[DEBUG] Chat found: ${chat.title}, Type: ${chat.type}, ID: ${chat.id}`);
        
        if (chat.type !== 'channel') {
            return { valid: false, error: 'Target bukanlah channel Telegram yang valid.' };
        }
        
        // Try to get bot's member status
        const botInfo = await bot.getMe();
        console.log(`[DEBUG] Bot info: @${botInfo.username}, ID: ${botInfo.id}`);
        
        try {
            const botMember = await bot.getChatMember(`@${cleanUsername}`, botInfo.id);
            console.log(`[DEBUG] Bot member status: ${botMember.status}`);
            
            return {
                valid: true,
                channelId: chat.id,
                channelTitle: chat.title,
                isAdmin: ['administrator', 'creator'].includes(botMember.status),
                botStatus: botMember.status
            };
        } catch (memberError) {
            console.log(`[DEBUG] Member check error: ${memberError.message}`);
            
            // If we can't get member status but can access the chat, it might be a permission issue
            if (memberError.response?.body?.description?.includes('member list is inaccessible')) {
                return { 
                    valid: false, 
                    error: 'Channel bersifat private atau bot tidak memiliki akses. Pastikan channel bersifat public atau undang bot terlebih dahulu.' 
                };
            }
            
            // If bot is not a member but chat exists, it means bot needs to be invited
            if (memberError.response?.body?.description?.includes('user not found')) {
                return { 
                    valid: false, 
                    error: 'Bot belum diundang ke channel. Silakan undang bot ke channel terlebih dahulu.' 
                };
            }
            
            throw memberError;
        }
        
    } catch (error) {
        console.log(`[DEBUG] Channel access error: ${error.message}`);
        console.log(`[DEBUG] Error details:`, error.response?.body);
        
        if (error.response?.body?.description?.includes('chat not found')) {
            return { valid: false, error: 'Channel tidak ditemukan. Pastikan username channel benar dan channel bersifat public.' };
        }
        
        if (error.response?.body?.description?.includes('bot was kicked')) {
            return { valid: false, error: 'Bot telah di-kick dari channel. Silakan undang kembali bot sebagai admin.' };
        }
        
        if (error.response?.body?.description?.includes('member list is inaccessible')) {
            return { 
                valid: false, 
                error: 'Channel bersifat private atau bot tidak memiliki akses. Pastikan channel bersifat public atau undang bot terlebih dahulu.' 
            };
        }
        
        if (error.response?.body?.description?.includes('forbidden')) {
            return { 
                valid: false, 
                error: 'Bot tidak memiliki permission untuk mengakses channel. Pastikan bot sudah diundang dan memiliki akses yang tepat.' 
            };
        }
        
        // Handle unexpected errors
        console.error(`[ERROR] Unexpected error while validating channel access:`, error);
        return { valid: false, error: 'Terjadi kesalahan pada sistem. Tim teknis sudah diberitahu.' };
    }
}

async function inviteTechSupport(channelUsername) {
    try {
        const cleanUsername = channelUsername.startsWith('@') ? channelUsername.slice(1) : channelUsername;
        
        // Create invite link for tech support
        const inviteLink = await bot.createChatInviteLink(`@${cleanUsername}`, {
            name: 'Tech Support Access',
            creates_join_request: false,
            member_limit: 1
        });
        
        // Send invite to tech support
        const techSupportMessage = `
🔧 **Tech Support Invitation**

Channel: @${cleanUsername}
Invite Link: ${inviteLink.invite_link}

User membutuhkan bantuan setup untuk channel mereka.
        `;
        
        await bot.sendMessage(TECH_SUPPORT_USER_ID, techSupportMessage, {
            parse_mode: 'Markdown'
        });
        
        return { success: true, inviteLink: inviteLink.invite_link };
        
    } catch (error) {
        console.error('Failed to invite tech support:', error);
        return { success: false, error: error.message };
    }
}

// --- Bot Command Handlers ---

// Start Command
bot.onText(/\/start/, safeHandler(async function(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Ensure user exists in database
    await db.createOrUpdateUser({
        id: userId,
        username: msg.from.username,
        first_name: msg.from.first_name,
        last_name: msg.from.last_name
    });
    
    await db.logActivity(userId, null, 'start', 'User started bot');
    
    const welcomeMessage = `
👋 **Selamat Datang di Bot Creator Papa!**

Bot ini membantu Anda mengelola channel konten dengan sistem pembayaran terintegrasi.

**Fitur Utama:**
🎬 Upload konten dengan harga otomatis
💰 Integrasi pembayaran OY Indonesia  
📊 Management multi-channel
🔒 Sistem keamanan berlapis

**Perintah Yang Tersedia:**
/setup - Setup channel baru
/settings - Pengaturan channel dan pembayaran
/help - Bantuan lengkap

Untuk memulai, silakan gunakan perintah /setup untuk mengonfigurasi channel pertama Anda.
    `;
    
    await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 Setup Channel Baru', callback_data: 'setup_start' }],
                [{ text: '⚙️ Pengaturan', callback_data: 'settings_menu' }],
                [{ text: '❓ Bantuan', callback_data: 'help_menu' }]
            ]
        }
    });
}));

// Setup Command
bot.onText(/\/setup/, safeHandler(async function(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    await db.logActivity(userId, null, 'setup_start', 'User initiated setup');
    
    const setupMessage = `
🛠️ **Setup Channel Baru**

Ikuti langkah-langkah berikut untuk mengintegrasikan channel Anda dengan sistem pembayaran:

**Langkah 1: Username Channel**
Masukkan username channel Anda (format: @namachannel)

Pastikan:
✅ Channel sudah dibuat dan bersifat public
✅ Anda adalah owner/admin channel
✅ Channel belum terdaftar di bot lain
    `;
    
    // Initialize setup session
    userSessions.set(userId, {
        step: 'awaiting_channel',
        startTime: Date.now(),
        data: {}
    });
    
    await bot.sendMessage(chatId, setupMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '❌ Batal Setup', callback_data: 'setup_cancel' }]
            ]
        }
    });
}));

// Settings Command - Pengaturan channel dan pembayaran
bot.onText(/\/settings/, safeHandler(async function(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    await showSettingsMenu(chatId, userId);
}));

// Help Command - Bantuan lengkap menggunakan bot
bot.onText(/\/help/, safeHandler(async function(msg) {
    const chatId = msg.chat.id;
    
    await showHelpMenu(chatId);
}));

// Support Command - Chat langsung ke admin bot
bot.onText(/\/support/, safeHandler(async function(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const supportMessage = `
🆘 **Dukungan Teknis**

Butuh bantuan? Hubungi tim support kami:

👨‍💻 **Tech Support:** @${TECH_SUPPORT_USERNAME} (${TECH_SUPPORT_DISPLAY_NAME})
📧 **User ID Anda:** \`${userId}\`

**Masalah Umum:**
• Setup channel gagal
• Bot tidak bisa posting
• Masalah pembayaran OY Indonesia
• Error saat upload konten

**Tips Cepat:**
✅ Pastikan bot sudah jadi admin di channel
✅ Periksa format caption: #harga#deskripsi
✅ API Key OY Indonesia valid dan aktif

Tim support siap membantu 24/7!
    `;
    
    await bot.sendMessage(chatId, supportMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '💬 Chat dengan Support', url: `https://t.me/${TECH_SUPPORT_USERNAME}` }],
                [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
            ]
        }
    });
    
    await db.logActivity(userId, null, 'support_request', 'User requested support');
}));

// Donate Command - Traktir kopi buat admin
bot.onText(/\/donate/, safeHandler(async function(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const donateMessage = `
☕ **Traktir Kopi Buat Admin**

Terima kasih telah menggunakan Bot Creator Papa! 

Jika bot ini membantu bisnis konten Anda, dukung pengembangan dengan memberikan donasi.

💝 **Donasi membantu:**
• Maintenance server dan database
• Pengembangan fitur baru
• Support teknis 24/7
• Update keamanan

Setiap dukungan sangat berarti untuk kami! 🙏
    `;
    
    await bot.sendMessage(chatId, donateMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '💰 Donasi Sekarang', url: process.env.DONATION_URL || 'https://papabadak.carrd.co/' }],
                [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
            ]
        }
    });
    
    await db.logActivity(userId, null, 'donation_view', 'User viewed donation page');
}));

// Promo Command - Mengatur promosi channel
bot.onText(/\/promo/, safeHandler(async function(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if user has channels
    const channels = await db.getUserChannels(userId);
    if (channels.length === 0) {
        await bot.sendMessage(chatId, 
            '❌ Anda belum memiliki channel yang terdaftar.\n\n' +
            'Gunakan /setup untuk mendaftarkan channel terlebih dahulu.'
        );
        return;
    }
    
    await showPromoManagement(chatId, userId, channels);
}));

async function showPromoManagement(chatId, userId, channels) {
    const promoText = `
🎉 **Kelola Promosi Channel**

**Jenis Promosi Yang Tersedia:**

📊 **1. Diskon Video**
• Berikan diskon persentase untuk semua video
• Contoh: 10% off semua konten

💰 **2. Bonus Top-Up**
• User top-up X rupiah, dapat bonus Y%
• Contoh: Top-up 50rb dapat bonus 10% (5rb)

**Channel Anda:**
${channels.map((ch, i) => 
    `${i + 1}. ${ch.channel_title || ch.channel_username}\n` +
    `   Status: ${ch.setup_completed ? '✅ Aktif' : '⚠️ Setup belum selesai'}`
).join('\n')}

Pilih channel untuk mengatur promosi:
    `;
    
    const keyboard = channels.map((channel, index) => ([
        { text: `📊 ${channel.channel_title || channel.channel_username}`, callback_data: `promo_select_${channel.id}` }
    ]));
    
    keyboard.push([{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]);
    
    await bot.sendMessage(chatId, promoText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

// Handle text messages for setup process
bot.on('message', safeHandler(async function(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    // Skip if it's a command
    if (text?.startsWith('/')) return;
    
    const session = userSessions.get(userId);
    if (!session) return;
    
    switch (session.step) {
        case 'awaiting_channel':
            await handleChannelInput(msg, session);
            break;
            
        case 'awaiting_api_key':
            await handleApiKeyInput(msg, session);
            break;
            
        case 'api_key_input':
            await handleApiKeyUpdate(msg, session);
            break;
            
        case 'awaiting_discount':
            await handleDiscountInput(msg, session);
            break;
            
        case 'awaiting_topup_bonus':
            await handleTopupBonusInput(msg, session);
            break;
    }
}));

async function handleChannelInput(msg, session) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const channelUsername = msg.text.trim();
    
    // Validate channel username format
    const { error } = schemas.channelUsername.validate(channelUsername);
    if (error) {
        await bot.sendMessage(chatId, 
            '❌ Format username channel tidak valid!\n\n' +
            'Format yang benar: @namaChannel\n' +
            'Contoh: @videokonten123\n\n' +
            'Silakan masukkan username channel yang benar:'
        );
        return;
    }
    
    const statusMsg = await bot.sendMessage(chatId, '🔍 Memeriksa channel...');
    
    // Validate channel access
    const validation = await validateChannelAccess(channelUsername);
    
    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
    
    if (!validation.valid) {
        await bot.sendMessage(chatId, 
            `❌ **Gagal mengakses channel**\n\n${validation.error}\n\n` +
            'Silakan periksa kembali dan masukkan username channel yang benar:'
        , { parse_mode: 'Markdown' });
        return;
    }
    
    // Store channel data in session
    session.data.channelUsername = channelUsername;
    session.data.channelId = validation.channelId;
    session.data.channelTitle = validation.channelTitle;
    session.data.isAdmin = validation.isAdmin;
    
    if (!validation.isAdmin) {
        // Try to invite tech support even if bot is not admin yet.
        // This allows the user to manually add them while they add the bot.
        const techInvite = await inviteTechSupport(channelUsername);

        const adminInstructions = `
✅ *Channel ditemukan: ${escapeMarkdownV2(validation.channelTitle)}*

⚠️ *Bot belum menjadi admin di channel Anda*

*Langkah selanjutnya:*
1\\. Buka channel ${escapeMarkdownV2(channelUsername)}
2\\. Klik "⚙️ Manage Channel" → "👥 Administrators"
3\\. Klik "➕ Add Admin" 
4\\. Cari dan pilih bot ini (@${escapeMarkdownV2((await bot.getMe()).username)})
5\\. Berikan permission: "Post Messages", "Edit Messages", "Delete Messages"
6\\. Klik "✅ Done"

Setelah menambahkan bot sebagai admin, klik tombol "Verifikasi Admin" di bawah ini.

${techInvite.success 
    ? `ℹ️ _Sambil menunggu, tim teknis @${escapeMarkdownV2(TECH_SUPPORT_USERNAME)} telah dikirimi link undangan untuk membantu jika diperlukan\\._` 
    : `⚠️ _Gagal membuat link undangan untuk tech support\\. Anda mungkin perlu mengundang @${escapeMarkdownV2(TECH_SUPPORT_USERNAME)} secara manual\\._`
}
        `;
        
        await bot.sendMessage(chatId, adminInstructions, {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Verifikasi Admin', callback_data: 'verify_admin' }],
                    [{ text: '❌ Batal Setup', callback_data: 'setup_cancel' }]
                ]
            }
        });
        
        session.step = 'awaiting_admin_verification';
        
    } else {
        // Bot is already admin, invite tech support and proceed to API key
        session.data.techInvite = await inviteTechSupport(channelUsername);
        await proceedToApiKey(chatId, userId, session);
    }
}

async function proceedToApiKey(chatId, userId, session) {
    const apiKeyMessage = `
✅ *Channel berhasil diverifikasi\\!*

*Channel:* ${escapeMarkdownV2(session.data.channelTitle)}
*Username:* ${escapeMarkdownV2(session.data.channelUsername)}

*Langkah 2: OY Indonesia API Key*

Masukkan API Key dari OY Indonesia untuk integrasi pembayaran:

*Cara mendapatkan API Key:*
1\\. Login ke dashboard OY Indonesia
2\\. Buka menu "API Management" 
3\\. Copy "Production API Key" atau "Sandbox API Key"

⚠️ *Keamanan:* API Key akan dienkripsi dan disimpan dengan aman\\.
    `;
    
    await bot.sendMessage(chatId, apiKeyMessage, {
        parse_mode: 'MarkdownV2',
        reply_markup: {
            inline_keyboard: [
                [{ text: '❓ Cara Mendapat API Key', url: 'https://docs.oyindonesia.com/' }],
                [{ text: '❌ Batal Setup', callback_data: 'setup_cancel' }]
            ]
        }
    });
    
    session.step = 'awaiting_api_key';
}

async function handleApiKeyInput(msg, session) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const apiKey = msg.text.trim();
    
    // Delete the message containing API key for security
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    
    // Validate API key format
    const { error } = schemas.oyApiKey.validate(apiKey);
    if (error) {
        await bot.sendMessage(chatId, 
            '❌ Format API Key tidak valid\\!\n\n' +
            'API Key harus minimal 10 karakter\\.\n' +
            'Silakan masukkan API Key yang benar:',
            { parse_mode: 'MarkdownV2' }
        );
        return;
    }
    
    const statusMsg = await bot.sendMessage(chatId, '🔐 Memvalidasi API Key...');
    
    // TODO: Add actual API key validation with OY Indonesia
    // For now, we'll assume it's valid
    const isValidApiKey = true;
    
    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
    
    if (!isValidApiKey) {
        await bot.sendMessage(chatId, 
            '❌ API Key tidak valid atau tidak memiliki akses yang diperlukan\\.\n\n' +
            'Pastikan API Key benar dan memiliki permission untuk payment gateway\\.\n' +
            'Silakan masukkan API Key yang benar:',
            { parse_mode: 'MarkdownV2' }
        );
        return;
    }
    
    // Save to database
    try {
        // Use upsert to handle both new and existing channel setups
        const channelId = await db.upsertChannel(
            userId, 
            session.data.channelUsername, 
            apiKey
        );

        if (!channelId) {
            throw new Error('Failed to get channel ID after upsert.');
        }
        
        await db.updateChannelStatus(channelId, {
            channel_id: session.data.channelId,
            channel_title: session.data.channelTitle,
            bot_admin_status: 'verified',
            setup_completed: true
        });
        
        // Use the tech invite result from the previous step
        const techInvite = session.data.techInvite || { success: false };
        
        if (techInvite.success) {
            await db.updateChannelStatus(channelId, {
                tech_support_invited: true
            });
        }
        
        await db.logActivity(userId, channelId, 'setup_complete', 'Channel setup completed successfully');
        
        const techSupportInviteMessage = techInvite.success 
            ? `✅ @${escapeMarkdownV2(TECH_SUPPORT_USERNAME)} \\(${escapeMarkdownV2(TECH_SUPPORT_DISPLAY_NAME)}\\) telah diundang sebagai tech support\\.` 
            : `⚠️ Gagal mengundang tech support\\. Silakan undang @${escapeMarkdownV2(TECH_SUPPORT_USERNAME)} secara manual\\.`;

        const successMessage = `
🎉 *Setup Berhasil Diselesaikan\\!*

*Channel:* ${escapeMarkdownV2(session.data.channelTitle)}
*Username:* ${escapeMarkdownV2(session.data.channelUsername)}
*Status:* ✅ Siap digunakan

*Langkah Selanjutnya:*
1\\. Upload konten dengan format: image \\+ video \\+ caption
2\\. Format caption: \\#harga\\#deskripsi \\(contoh: \\#15000\\#Video menarik\\!\\)
3\\. Bot akan otomatis posting preview di channel Anda

*Perintah yang tersedia:*
/upload \\- Upload konten baru
/settings \\- Ubah pengaturan
/help \\- Bantuan lengkap

${techSupportInviteMessage}
        `;
        
        await bot.sendMessage(chatId, successMessage, {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📤 Upload Konten Pertama', callback_data: 'upload_start' }],
                    [{ text: '⚙️ Pengaturan', callback_data: 'settings_menu' }]
                ]
            }
        });
        
        // Clear session
        userSessions.delete(userId);
        
    } catch (error) {
        console.error('Database error during setup:', error);
        await bot.sendMessage(chatId, 
            '❌ Gagal menyimpan konfigurasi channel\\.\n\n' +
            'Terjadi kesalahan pada database\\. Silakan coba lagi atau hubungi tech support\\.',
            { parse_mode: 'MarkdownV2' }
        );
    }
}

async function handleApiKeyUpdate(msg, session) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const apiKey = msg.text.trim();
    
    // Delete the message containing API key for security
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    
    // Validate API key format
    const { error } = schemas.oyApiKey.validate(apiKey);
    if (error) {
        await bot.sendMessage(chatId, 
            '❌ Format API Key tidak valid!\n\n' +
            'API Key harus minimal 10 karakter.\n' +
            'Silakan masukkan API Key yang benar:'
        );
        return;
    }
    
    const statusMsg = await bot.sendMessage(chatId, '🔐 Memperbarui API Key...');
    
    try {
        // Update API key in database
        await db.updateChannelApiKey(session.channelId, apiKey);
        
        // Get channel info
        const channel = await db.getChannelById(session.channelId);
        
        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        
        const successMessage = `
🎉 **API Key Berhasil Diperbarui!**

**Channel:** ${channel.channel_title || channel.channel_username}
**Status:** ✅ API Key baru telah tersimpan dengan aman

API Key telah dienkripsi dan disimpan dalam database. Channel Anda siap untuk menerima pembayaran.
        `;
        
        // Update the original message
        await bot.editMessageText(successMessage, {
            chat_id: chatId,
            message_id: session.messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⚙️ Kelola Channel', callback_data: `channel_manage_${session.channelId}` }],
                    [{ text: '🔙 Kembali ke Pengaturan', callback_data: 'settings_menu' }]
                ]
            }
        });
        
        await db.logActivity(userId, session.channelId, 'api_key_updated', 'API key updated successfully');
        
        // Clear session
        userSessions.delete(userId);
        
    } catch (error) {
        console.error('Error updating API key:', error);
        
        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        
        await bot.sendMessage(chatId, 
            '❌ Gagal memperbarui API Key.\n\n' +
            'Terjadi kesalahan pada database. Silakan coba lagi atau hubungi tech support.'
        );
    }
}

async function handleChannelDelete(query, channelId) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        const channel = await db.getChannelById(channelId);
        
        if (!channel || channel.user_id !== userId) {
            await bot.editMessageText(
                '❌ Channel tidak ditemukan atau Anda tidak memiliki akses.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Kembali', callback_data: 'manage_channels' }]
                        ]
                    }
                }
            );
            return;
        }
        
        const username = channel.channel_username.startsWith('@') ? channel.channel_username : `@${channel.channel_username}`;
        const confirmText = `
⚠️ Konfirmasi Hapus Channel

Channel: ${channel.channel_title || channel.channel_username}
Username: ${username}

PERINGATAN:
• Semua data channel akan dihapus permanen
• Semua konten yang sudah diupload akan hilang
• Aksi ini tidak dapat dibatalkan

Apakah Anda yakin ingin menghapus channel ini?
        `;
        
        const keyboard = [
            [
                { text: '❌ Batal', callback_data: `channel_manage_${channelId}` },
                { text: '🗑️ Hapus Permanen', callback_data: `confirm_delete_${channelId}` }
            ]
        ];
        
        await bot.editMessageText(confirmText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: keyboard }
        });
        
    } catch (error) {
        console.error('Error in handleChannelDelete:', error);
        await bot.editMessageText(
            '❌ Terjadi kesalahan saat memuat informasi channel.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Kembali', callback_data: 'manage_channels' }]
                    ]
                }
            }
        );
    }
}

async function handleChannelDeleteConfirm(query, channelId) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        const channel = await db.getChannelById(channelId);
        
        if (!channel || channel.user_id !== userId) {
            await bot.editMessageText(
                '❌ Channel tidak ditemukan atau Anda tidak memiliki akses.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Kembali', callback_data: 'manage_channels' }]
                        ]
                    }
                }
            );
            return;
        }
        
        const statusMsg = await bot.editMessageText(
            '🗑️ Menghapus channel dan semua data terkait...',
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        
        // Log activity BEFORE deleting channel (with NULL channel_id since it will be deleted)
        await db.logActivity(userId, null, 'channel_deleted', `Channel ${channel.channel_username} deleted by user`);
        
        // Delete channel from database
        await db.deleteChannel(channelId);
        
        const successText = `
✅ Channel Berhasil Dihapus

Channel: ${channel.channel_title || channel.channel_username}

Semua data channel telah dihapus permanen dari sistem.

Yang telah dihapus:
• Data channel dan konfigurasi
• Semua konten yang diupload
• Log aktivitas terkait channel
• API key yang tersimpan

Anda dapat menambahkan channel baru kapan saja melalui menu setup.
        `;
        
        await bot.editMessageText(successText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🆕 Setup Channel Baru', callback_data: 'setup_start' }],
                    [{ text: '📊 Kelola Channel Lain', callback_data: 'manage_channels' }],
                    [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
                ]
            }
        });
        
    } catch (error) {
        console.error('Error in handleChannelDeleteConfirm:', error);
        await bot.editMessageText(
            '❌ Gagal menghapus channel. Terjadi kesalahan pada database.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Kembali', callback_data: 'manage_channels' }]
                    ]
                }
            }
        );
    }
}

// --- Callback Query Handlers ---
bot.on('callback_query', safeHandler(async function(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    await bot.answerCallbackQuery(query.id).catch(() => {});
    
    switch (data) {
        case 'setup_start':
            // Call setup function directly instead of sending text
            const setupMessage = `
🛠️ **Setup Channel Baru**

Ikuti langkah-langkah berikut untuk mengintegrasikan channel Anda dengan sistem pembayaran:

**Langkah 1: Username Channel**
Masukkan username channel Anda (format: @namachannel)

Pastikan:
✅ Channel sudah dibuat dan bersifat public
✅ Anda adalah owner/admin channel
✅ Channel belum terdaftar di bot lain
            `;
            
            // Initialize setup session
            userSessions.set(userId, {
                step: 'awaiting_channel',
                startTime: Date.now(),
                data: {}
            });
            
            await bot.editMessageText(setupMessage, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Batal Setup', callback_data: 'setup_cancel' }]
                    ]
                }
            });
            
            await db.logActivity(userId, null, 'setup_start', 'User initiated setup');
            break;
            
        case 'setup_cancel':
            userSessions.delete(userId);
            await bot.editMessageText(
                '❌ Setup dibatalkan.\n\nAnda dapat memulai setup lagi kapan saja dengan perintah /setup',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            );
            break;
            
        case 'verify_admin':
            await handleAdminVerification(query);
            break;
            
        case 'settings_menu':
            await handleSettingsMenu(query);
            break;
            
        case 'help_menu':
            await handleHelpMenu(query);
            break;
            
        case 'donate_menu':
            await handleDonateMenu(query);
            break;
            
        case 'upload_start':
            await handleUploadStart(query);
            break;
            
        case 'manage_channels':
            await handleManageChannels(query);
            break;
            
        case 'change_api_key':
            await handleChangeApiKey(query);
            break;
            
        case 'main_menu':
            // Show main menu directly
            const mainMenuText = `
👋 **Bot Creator Papa - Menu Utama**

Pilih menu yang ingin Anda akses:
            `;
            
            await bot.editMessageText(mainMenuText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Setup Channel', callback_data: 'setup_start' }],
                        [{ text: '⚙️ Pengaturan', callback_data: 'settings_menu' }],
                        [{ text: '🎉 Kelola Promo', callback_data: 'promo_menu' }],
                        [{ text: '📤 Upload Konten', callback_data: 'upload_start' }],
                        [{ text: '❓ Bantuan', callback_data: 'help_menu' }],
                        [{ text: '💝 Donasi', callback_data: 'donate_menu' }]
                    ]
                }
            });
            break;
            
        case 'promo_menu':
            const channels = await db.getUserChannels(userId);
            if (channels.length === 0) {
                await bot.editMessageText(
                    '❌ Anda belum memiliki channel yang terdaftar.\n\nGunakan /setup untuk mendaftarkan channel terlebih dahulu.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🚀 Setup Channel', callback_data: 'setup_start' }],
                                [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                            ]
                        }
                    }
                );
                return;
            }
            
            // Edit message to show promo management
            const promoText = `
🎉 **Kelola Promosi Channel**

**Jenis Promosi Yang Tersedia:**

📊 **1. Diskon Video**
• Berikan diskon persentase untuk semua video
• Contoh: 10% off semua konten

💰 **2. Bonus Top-Up**
• User top-up X rupiah, dapat bonus Y%
• Contoh: Top-up 50rb dapat bonus 10% (5rb)

**Channel Anda:**
${channels.map((ch, i) => 
    `${i + 1}. ${ch.channel_title || ch.channel_username}\n` +
    `   Status: ${ch.setup_completed ? '✅ Aktif' : '⚠️ Setup belum selesai'}`
).join('\n')}

Pilih channel untuk mengatur promosi:
            `;
            
            const keyboard = channels.map((channel, index) => ([
                { text: `📊 ${channel.channel_title || channel.channel_username}`, callback_data: `promo_select_${channel.id}` }
            ]));
            
            keyboard.push([{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]);
            
            await bot.editMessageText(promoText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
            break;
            
        // Handle content posting confirmations
        default:
            if (data.startsWith('post_')) {
                const contentId = parseInt(data.substring(5));
                await handleContentPosting(query, contentId);
            } else if (data.startsWith('edit_')) {
                const contentId = parseInt(data.substring(5));
                await handleContentEdit(query, contentId);
            } else if (data.startsWith('delete_')) {
                const contentId = parseInt(data.substring(7));
                await handleContentDelete(query, contentId);
            } else if (data.startsWith('promo_select_')) {
                const channelId = parseInt(data.substring(13));
                await showChannelPromoOptions(query, channelId);
            } else if (data.startsWith('promo_discount_')) {
                const channelId = parseInt(data.substring(15));
                await setupDiscountPromo(query, channelId);
            } else if (data.startsWith('promo_topup_')) {
                const channelId = parseInt(data.substring(12));
                await setupTopupBonusPromo(query, channelId);
            } else if (data.startsWith('channel_manage_')) {
                const channelId = parseInt(data.substring(15));
                await handleChannelManage(query, channelId);
            } else if (data.startsWith('api_change_')) {
                const channelId = parseInt(data.substring(11));
                await handleApiKeyChange(query, channelId);
            } else if (data.startsWith('channel_delete_')) {
                const channelId = parseInt(data.substring(15));
                await handleChannelDelete(query, channelId);
            } else if (data.startsWith('confirm_delete_')) {
                const channelId = parseInt(data.substring(15));
                await handleChannelDeleteConfirm(query, channelId);
            }
            break;
    }
}));

async function handleAdminVerification(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const session = userSessions.get(userId);
    
    if (!session || session.step !== 'awaiting_admin_verification') {
        await bot.editMessageText(
            '❌ Sesi setup tidak valid. Silakan mulai setup ulang dengan /setup',
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        return;
    }
    
    const statusMsg = await bot.sendMessage(chatId, '🔍 Memverifikasi status admin...');
    
    // Re-check admin status
    const validation = await validateChannelAccess(session.data.channelUsername);
    
    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
    
    if (!validation.valid || !validation.isAdmin) {
        const errorMessage = validation.valid 
            ? `⚠️ **Bot belum menjadi admin**\n\nBot masih belum memiliki akses admin di channel ${escapeMarkdownV2(session.data.channelUsername)}\\.\n\nSilakan tambahkan bot sebagai admin terlebih dahulu, lalu coba verifikasi lagi.`
            : `❌ **Gagal memverifikasi channel**\n\n${escapeMarkdownV2(validation.error)}\n\nSilakan periksa kembali pengaturan channel Anda.`;

        await bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Verifikasi Lagi', callback_data: 'verify_admin' }],
                    [{ text: '❌ Batal Setup', callback_data: 'setup_cancel' }]
                ]
            }
        });
        return;
    }
    
    // Admin verification successful
    session.data.isAdmin = true;
    
    // If tech support wasn't invited before, invite them now.
    if (!session.data.techInvite) {
        session.data.techInvite = await inviteTechSupport(session.data.channelUsername);
    }

    await bot.editMessageText(
        `✅ **Verifikasi admin berhasil!**\n\nBot sekarang memiliki akses admin di channel ${escapeMarkdownV2(session.data.channelTitle)}\\.\n\nMelanjutkan ke langkah berikutnya...`,
        {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'MarkdownV2'
        }
    );
    
    // Proceed to API key step
    setTimeout(async () => {
        await proceedToApiKey(chatId, userId, session);
    }, 2000);
}

// --- Media Upload System ---
const mediaUploadSessions = new Map(); // userId -> { files: [], timeout: timeoutId }

bot.on('message', safeHandler(async function(msg) {
    // Skip non-media messages or commands
    if (!msg.video && !msg.photo && !msg.document) return;
    if (msg.text?.startsWith('/')) return;
    
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    // Check if user has any channels set up
    const userChannels = await db.getUserChannels(userId);
    if (userChannels.length === 0) {
        await bot.sendMessage(chatId, 
            '❌ Anda belum memiliki channel yang terdaftar.\n\n' +
            'Silakan gunakan /setup untuk mendaftarkan channel Anda terlebih dahulu.'
        );
        return;
    }
    
    // Handle media upload
    await handleMediaUpload(msg, userChannels[0]); // Use first channel for now
}));

async function handleMediaUpload(msg, channel) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const mediaGroupId = msg.media_group_id;
    
    // If it's part of a media group, collect all files
    if (mediaGroupId) {
        await handleMediaGroup(msg, channel, mediaGroupId);
        return;
    }
    
    // Single file upload
    if (msg.video) {
        await handleSingleVideoUpload(msg, channel);
    } else {
        await bot.sendMessage(chatId, 
            '❌ Untuk upload konten, kirimkan video beserta gambar thumbnail dalam satu media group.\n\n' +
            'Format: pilih beberapa file (video + gambar) dan kirim bersamaan dengan caption format: #harga#deskripsi'
        );
    }
}

async function handleMediaGroup(msg, channel, mediaGroupId) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    // Initialize or get existing session
    if (!mediaUploadSessions.has(userId)) {
        mediaUploadSessions.set(userId, {
            files: [],
            caption: '',
            channelId: channel.id,
            timeout: null
        });
    }
    
    const session = mediaUploadSessions.get(userId);
    
    // Clear previous timeout
    if (session.timeout) {
        clearTimeout(session.timeout);
    }
    
    // Collect media files
    if (msg.video) {
        session.files.push({
            type: 'video',
            file_id: msg.video.file_id,
            duration: msg.video.duration,
            file_size: msg.video.file_size
        });
    }
    
    if (msg.photo) {
        session.files.push({
            type: 'photo',
            file_id: msg.photo[msg.photo.length - 1].file_id // Get highest resolution
        });
    }
    
    // Store caption if provided
    if (msg.caption) {
        session.caption = msg.caption;
    }
    
    // Set timeout to process after 3 seconds of no new files
    session.timeout = setTimeout(async () => {
        await processMediaGroup(userId, chatId, session);
        mediaUploadSessions.delete(userId);
    }, 3000);
}

async function processMediaGroup(userId, chatId, session) {
    const { files, caption, channelId } = session;
    
    // Validate media group
    const videos = files.filter(f => f.type === 'video');
    const photos = files.filter(f => f.type === 'photo');
    
    if (videos.length === 0) {
        await bot.sendMessage(chatId, 
            '❌ Media group harus mengandung minimal 1 video.\n\n' +
            'Format yang benar: video + gambar thumbnail + caption (#harga#deskripsi)'
        );
        return;
    }
    
    if (!caption) {
        await bot.sendMessage(chatId, 
            '❌ Caption tidak ditemukan.\n\n' +
            'Format caption: #harga#deskripsi\n' +
            'Contoh: #15000#Video tutorial menarik!'
        );
        return;
    }
    
    // Parse caption
    const captionMatch = caption.match(/^#(\d+)#(.+)$/);
    if (!captionMatch) {
        await bot.sendMessage(chatId, 
            '❌ Format caption tidak valid.\n\n' +
            'Format yang benar: #harga#deskripsi\n' +
            'Contoh: #15000#Video tutorial yang sangat menarik!'
        );
        return;
    }
    
    const price = parseInt(captionMatch[1]);
    const description = captionMatch[2].trim();
    
    if (price < 1000 || price > 1000000) {
        await bot.sendMessage(chatId, 
            '❌ Harga tidak valid.\n\n' +
            'Harga harus antara Rp 1.000 - Rp 1.000.000'
        );
        return;
    }
    
    // Create media content record
    try {
        const contentId = await db.createMediaContent({
            channel_id: channelId,
            user_id: userId,
            video_file_id: videos[0].file_id,
            image_file_id: photos.length > 0 ? photos[0].file_id : null,
            base_price_idr: price,
            caption: description,
            raw_caption: caption,
            video_duration: videos[0].duration || 0
        });
        
        await db.logActivity(userId, channelId, 'media_upload', 'Media content uploaded', {
            content_id: contentId,
            price: price,
            files_count: files.length
        });
        
        // Show preview and ask for confirmation
        await showPreviewAndConfirm(chatId, userId, contentId, {
            video: videos[0],
            image: photos[0] || null,
            price: price,
            description: description
        });
        
    } catch (error) {
        console.error('Error creating media content:', error);
        await bot.sendMessage(chatId, 
            '❌ Gagal menyimpan konten.\n\n' +
            'Terjadi kesalahan sistem. Silakan coba lagi.'
        );
    }
}

async function showPreviewAndConfirm(chatId, userId, contentId, content) {
    const { video, image, price, description } = content;
    
    const previewText = `
🎬 **Preview Konten**

💰 **Harga:** Rp ${price.toLocaleString('id-ID')}
📝 **Deskripsi:** ${description}

📹 **Video:** ${video.duration}s (${(video.file_size / 1024 / 1024).toFixed(1)}MB)
${image ? '🖼️ **Thumbnail:** Ada' : '⚠️ **Thumbnail:** Tidak ada'}

Apakah Anda ingin memposting konten ini ke channel?
    `;
    
    const keyboard = [
        [
            { text: '✅ Posting Sekarang', callback_data: `post_${contentId}` },
            { text: '✏️ Edit', callback_data: `edit_${contentId}` }
        ]
    ];
    
    // Send preview with thumbnail if available
    if (image) {
        await bot.sendPhoto(chatId, image.file_id, {
            caption: previewText,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } else {
        await bot.sendMessage(chatId, previewText, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }
}

async function showSettingsMenu(chatId, userId) {
    const channels = await db.getUserChannels(userId);
    
    if (channels.length === 0) {
        await bot.sendMessage(chatId, 
            '❌ Anda belum memiliki channel yang terdaftar.\n\n' +
            'Gunakan /setup untuk mendaftarkan channel pertama Anda.'
        );
        return;
    }
    
    const settingsText = `
⚙️ **Pengaturan Bot Creator Papa**

**Channel Anda:**
${channels.map((ch, i) => 
    `${i + 1}. ${ch.channel_title || ch.channel_username}\n` +
    `   Status: ${ch.setup_completed ? '✅ Aktif' : '⚠️ Setup belum selesai'}`
).join('\n')}

Pilih pengaturan yang ingin Anda ubah:
    `;
    
    const keyboard = [
        [{ text: '📊 Kelola Channel', callback_data: 'manage_channels' }],
        [{ text: '🔑 Ubah API Key', callback_data: 'change_api_key' }],
        [{ text: '🆕 Tambah Channel', callback_data: 'setup_start' }],
        [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
    ];
    
    await bot.sendMessage(chatId, settingsText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function showHelpMenu(chatId) {
    const helpText = `
❓ **Bantuan Bot Creator Papa**

**Perintah Utama:**
/start - Mulai menggunakan bot
/setup - Setup channel baru
/settings - Pengaturan channel dan API

**Cara Upload Konten:**
1. Pilih video + gambar thumbnail
2. Kirim bersamaan (media group)
3. Tambahkan caption: #harga#deskripsi
4. Contoh: #15000#Video tutorial menarik!

**Format yang Didukung:**
📹 Video: MP4, AVI, MOV (max 50MB)
🖼️ Gambar: JPG, PNG (untuk thumbnail)

**Dukungan Teknis:**
Hubungi @${TECH_SUPPORT_USERNAME} (${TECH_SUPPORT_DISPLAY_NAME}) untuk bantuan teknis.

**Fitur:**
✅ Multi-channel management
✅ Integrasi pembayaran OY Indonesia
✅ Preview sebelum posting
✅ Sistem keamanan berlapis
    `;
    
    await bot.sendMessage(chatId, helpText, {
        parse_mode: 'Markdown'
    });
}

async function startUploadProcess(chatId, userId) {
    const channels = await db.getUserChannels(userId);
    
    if (channels.length === 0) {
        await bot.sendMessage(chatId, 
            '❌ Anda belum memiliki channel yang terdaftar.\n\n' +
            'Gunakan /setup untuk mendaftarkan channel pertama Anda.'
        );
        return;
    }
    
    const uploadText = `
📤 **Upload Konten Baru**

**Cara Upload:**
1. Pilih video dan gambar thumbnail
2. Kirim bersamaan (pilih multiple files)
3. Tambahkan caption dengan format: #harga#deskripsi

**Contoh Caption:**
#15000#Video tutorial Photoshop lengkap!
#25000#Tutorial coding React JS untuk pemula

**Catatan:**
- Harga dalam Rupiah (1000-1000000)
- Video maksimal 50MB
- Gambar untuk thumbnail (opsional tapi direkomendasikan)

Silakan kirim media group Anda sekarang!
    `;
    
    await bot.sendMessage(chatId, uploadText, {
        parse_mode: 'Markdown'
    });
}

async function handleContentPosting(query, contentId) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        // Get user's first channel
        const channels = await db.getUserChannels(userId);
        if (channels.length === 0) {
            const errorMessage = '❌ Channel tidak ditemukan\\. Silakan setup ulang\\.';
            
            if (query.message.photo) {
                await bot.sendMessage(chatId, errorMessage, { parse_mode: 'MarkdownV2' });
            } else {
                await bot.editMessageText(errorMessage, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'MarkdownV2'
                });
            }
            return;
        }
        
        const channel = channels[0];
        
        // Create preview post for channel (just thumbnail with dummy button)
        const previewMessage = `
🎬 **Konten Baru Tersedia\\!**

Klik tombol di bawah untuk melihat dan membeli konten ini\\.

💰 Harga mulai dari Rp 15\\.000
        `;
        
        // Post to channel (this would be the actual channel posting)
        // For security, we're showing a dummy button here
        if (query.message.photo) {
            await bot.sendPhoto(channel.channel_id || chatId, query.message.photo[0].file_id, {
                caption: previewMessage,
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💰 Beli Sekarang', url: `https://t.me/papabadak_content_bot?start=content_${contentId}` }]
                    ]
                }
            });
        }
        
        // Update content status in database
        // await db.updateMediaStatus(contentId, 'published');
        
        const successMessage = '✅ **Konten berhasil diposting\\!**\n\nKonten Anda telah dipublikasikan di channel dan siap untuk dijual\\.';
        
        if (query.message.photo) {
            await bot.sendMessage(chatId, successMessage, { parse_mode: 'MarkdownV2' });
        } else {
            await bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'MarkdownV2'
            });
        }
        
        await db.logActivity(userId, channel.id, 'content_published', 'Content successfully posted to channel', {
            content_id: contentId
        });
        
    } catch (error) {
        console.error('Error posting content:', error);
        const errorMessage = '❌ Gagal memposting konten\\.\n\nTerjadi kesalahan sistem\\. Silakan coba lagi\\.';
        
        if (query.message.photo) {
            await bot.sendMessage(chatId, errorMessage, { parse_mode: 'MarkdownV2' });
        } else {
            await bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'MarkdownV2'
            });
        }
    }
}

async function handleContentEdit(query, contentId) {
    const chatId = query.message.chat.id;
    
    // If the message has a photo, we need to send a new message instead of editing
    if (query.message.photo) {
        await bot.sendMessage(chatId, 
            '✏️ **Edit Konten**\n\nFitur edit konten akan segera tersedia\\.\n\nUntuk saat ini, silakan upload ulang konten dengan detail yang benar\\.',
            { parse_mode: 'MarkdownV2' }
        );
    } else {
        await bot.editMessageText(
            '✏️ **Edit Konten**\n\nFitur edit konten akan segera tersedia\\.\n\nUntuk saat ini, silakan upload ulang konten dengan detail yang benar\\.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'MarkdownV2'
            }
        );
    }
}

async function handleContentDelete(query, contentId) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    await bot.editMessageText(
        '🗑️ **Konten Dibatalkan**\n\nKonten telah dibatalkan dan tidak akan diposting ke channel.',
        {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
        }
    );
    
    // Log the cancellation
    await db.logActivity(userId, null, 'content_cancelled', 'User cancelled content posting', {
        content_id: contentId
    });
}

async function showChannelPromoOptions(query, channelId) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    // Get channel info
    const channel = await db.getChannel(channelId);
    if (!channel || channel.user_id !== userId) {
        await bot.editMessageText(
            '❌ Channel tidak ditemukan atau Anda tidak memiliki akses.',
            {
                chat_id: chatId,
                message_id: query.message.message_id
            }
        );
        return;
    }
    
    const promoOptionsText = `
🎉 **Kelola Promosi: ${channel.channel_title}**

Pilih jenis promosi yang ingin Anda atur:

📊 **Diskon Video**
• Berikan diskon persentase untuk semua video
• Otomatis terapkan ke semua konten
• Menarik lebih banyak pembeli

💰 **Bonus Top-Up**
• User top-up dapat bonus tambahan
• Meningkatkan loyalitas customer
• Mendorong top-up dalam jumlah besar

Pilih jenis promosi:
    `;
    
    await bot.editMessageText(promoOptionsText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📊 Setup Diskon Video', callback_data: `promo_discount_${channelId}` }],
                [{ text: '💰 Setup Bonus Top-Up', callback_data: `promo_topup_${channelId}` }],
                [{ text: '📋 Lihat Promo Aktif', callback_data: `promo_view_${channelId}` }],
                [{ text: '🔙 Kembali', callback_data: 'promo_menu' }]
            ]
        }
    });
}

async function setupDiscountPromo(query, channelId) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    const discountText = `
📊 **Setup Diskon Video**

Fitur ini akan memberikan diskon persentase untuk semua video di channel Anda.

**Contoh:**
• Diskon 10% → Video Rp 15.000 jadi Rp 13.500
• Diskon 25% → Video Rp 20.000 jadi Rp 15.000

**Format:** Masukkan persentase diskon (1-50)
**Contoh:** Ketik \`15\` untuk diskon 15%

⚠️ **Catatan:** Diskon akan berlaku untuk semua video baru dan yang sudah ada.

Masukkan persentase diskon yang diinginkan:
    `;
    
    await bot.editMessageText(discountText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔙 Kembali', callback_data: `promo_select_${channelId}` }]
            ]
        }
    });
    
    // Set user session for discount input
    userSessions.set(userId, {
        step: 'awaiting_discount',
        channelId: channelId,
        startTime: Date.now()
    });
}

async function setupTopupBonusPromo(query, channelId) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    const topupBonusText = `
💰 **Setup Bonus Top-Up**

Berikan bonus tambahan saat user melakukan top-up.

**Contoh:**
• Top-up min 50rb, bonus 10% (dapat 55rb)
• Top-up min 100rb, bonus 15% (dapat 115rb)

**Setting yang dibutuhkan:**
1. Minimal top-up (dalam ribuan)
2. Persentase bonus (1-30%)

**Format:** \`minimal_topup,bonus_persen\`
**Contoh:** \`50000,10\` (min 50rb, bonus 10%)

Masukkan pengaturan bonus:
    `;
    
    await bot.editMessageText(topupBonusText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔙 Kembali', callback_data: `promo_select_${channelId}` }]
            ]
        }
    });
    
    // Set user session for topup bonus input
    userSessions.set(userId, {
        step: 'awaiting_topup_bonus',
        channelId: channelId,
        startTime: Date.now()
    });
}

async function handleDiscountInput(msg, session) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = msg.text.trim();
    
    // Validate discount percentage
    const discountPercent = parseFloat(input);
    if (isNaN(discountPercent) || discountPercent < 1 || discountPercent > 50) {
        await bot.sendMessage(chatId, 
            '❌ Persentase diskon tidak valid!\n\n' +
            'Masukkan angka antara 1-50 (tanpa simbol %).\n' +
            'Contoh: 15 untuk diskon 15%'
        );
        return;
    }
    
    try {
        // Create discount promo
        const promoId = await db.createChannelPromo({
            channel_id: session.channelId,
            promo_type: 'discount',
            discount_percentage: discountPercent,
            bonus_min_topup: 0,
            bonus_percentage: 0,
            expires_at: null, // No expiry
            max_uses_per_user: null,
            total_max_uses: null
        });
        
        // Deactivate other discount promos for this channel
        const existingPromos = await db.getChannelPromos(session.channelId, false);
        for (const promo of existingPromos) {
            if (promo.promo_type === 'discount' && promo.id !== promoId) {
                await db.updatePromoStatus(promo.id, false);
            }
        }
        
        await db.logActivity(userId, session.channelId, 'promo_created', `Discount promo created: ${discountPercent}%`);
        
        const successMessage = `
✅ **Diskon Berhasil Diatur!**

📊 **Detail Promo:**
• Jenis: Diskon Video
• Persentase: ${discountPercent}%
• Status: Aktif
• Berlaku untuk: Semua video

**Contoh Harga Setelah Diskon:**
• Video Rp 15.000 → Rp ${(15000 * (100 - discountPercent) / 100).toLocaleString('id-ID')}
• Video Rp 25.000 → Rp ${(25000 * (100 - discountPercent) / 100).toLocaleString('id-ID')}

Diskon akan otomatis diterapkan untuk semua pembelian video di channel Anda!
        `;
        
        await bot.sendMessage(chatId, successMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 Kelola Promo Lain', callback_data: 'promo_menu' }],
                    [{ text: '🔙 Menu Utama', callback_data: 'main_menu' }]
                ]
            }
        });
        
        // Clear session
        userSessions.delete(userId);
        
    } catch (error) {
        console.error('Error creating discount promo:', error);
        await bot.sendMessage(chatId, 
            '❌ Gagal membuat promo diskon.\n\n' +
            'Terjadi kesalahan sistem. Silakan coba lagi.'
        );
    }
}

async function handleTopupBonusInput(msg, session) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = msg.text.trim();
    
    // Parse input format: minimal_topup,bonus_persen
    const parts = input.split(',');
    if (parts.length !== 2) {
        await bot.sendMessage(chatId, 
            '❌ Format tidak valid!\n\n' +
            'Format yang benar: minimal_topup,bonus_persen\n' +
            'Contoh: 50000,10 (min 50rb, bonus 10%)'
        );
        return;
    }
    
    const minTopup = parseInt(parts[0].trim());
    const bonusPercent = parseFloat(parts[1].trim());
    
    if (isNaN(minTopup) || minTopup < 10000 || minTopup > 1000000) {
        await bot.sendMessage(chatId, 
            '❌ Minimal top-up tidak valid!\n\n' +
            'Minimal top-up harus antara 10.000 - 1.000.000'
        );
        return;
    }
    
    if (isNaN(bonusPercent) || bonusPercent < 1 || bonusPercent > 30) {
        await bot.sendMessage(chatId, 
            '❌ Persentase bonus tidak valid!\n\n' +
            'Bonus harus antara 1% - 30%'
        );
        return;
    }
    
    try {
        // Create topup bonus promo
        const promoId = await db.createChannelPromo({
            channel_id: session.channelId,
            promo_type: 'topup_bonus',
            discount_percentage: 0,
            bonus_min_topup: minTopup,
            bonus_percentage: bonusPercent,
            expires_at: null, // No expiry
            max_uses_per_user: null,
            total_max_uses: null
        });
        
        // Deactivate other topup bonus promos for this channel
        const existingPromos = await db.getChannelPromos(session.channelId, false);
        for (const promo of existingPromos) {
            if (promo.promo_type === 'topup_bonus' && promo.id !== promoId) {
                await db.updatePromoStatus(promo.id, false);
            }
        }
        
        await db.logActivity(userId, session.channelId, 'promo_created', `Topup bonus promo created: min ${minTopup}, bonus ${bonusPercent}%`);
        
        const bonusAmount = minTopup * bonusPercent / 100;
        const totalReceived = minTopup + bonusAmount;
        
        const successMessage = `
✅ **Bonus Top-Up Berhasil Diatur!**

💰 **Detail Promo:**
• Jenis: Bonus Top-Up
• Minimal Top-Up: Rp ${minTopup.toLocaleString('id-ID')}
• Bonus: ${bonusPercent}%
• Status: Aktif

**Contoh:**
User top-up Rp ${minTopup.toLocaleString('id-ID')} → Dapat Rp ${totalReceived.toLocaleString('id-ID')}
(Bonus: Rp ${bonusAmount.toLocaleString('id-ID')})

Bonus akan otomatis diberikan saat user melakukan top-up sesuai syarat!
        `;
        
        await bot.sendMessage(chatId, successMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 Kelola Promo Lain', callback_data: 'promo_menu' }],
                    [{ text: '🔙 Menu Utama', callback_data: 'main_menu' }]
                ]
            }
        });
        
        // Clear session
        userSessions.delete(userId);
        
    } catch (error) {
        console.error('Error creating topup bonus promo:', error);
        await bot.sendMessage(chatId, 
            '❌ Gagal membuat promo bonus top-up.\n\n' +
            'Terjadi kesalahan sistem. Silakan coba lagi.'
        );
    }
}

// --- Startup & Production Configuration ---
(async function main() {
    // Cleanup old sessions periodically
    setInterval(async () => {
        try {
            const cleaned = await db.cleanupExpiredSessions();
            if (cleaned > 0) {
                console.log(`Cleaned up ${cleaned} expired upload sessions`);
            }
        } catch (error) {
            console.error('Error cleaning up sessions:', error);
        }
    }, 5 * 60 * 1000); // Every 5 minutes
    
    // Register command descriptions for BotFather
    const commands = [
        { command: 'start', description: 'Bot akan memperkenalkan diri' },
        { command: 'setup', description: 'Menambahkan channel baru' },
        { command: 'settings', description: 'Pengaturan channel dan pembayaran' },
        { command: 'help', description: 'Bantuan lengkap menggunakan bot' },
        { command: 'support', description: 'Chat langsung ke admin bot' },
        { command: 'donate', description: 'Traktir kopi buat admin' },
        { command: 'promo', description: 'Mengatur promosi channel' }
    ];
    
    try {
        await bot.setMyCommands(commands);
        console.log('✅ Bot commands registered');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
    
    // Setup webhook or polling
    if (USE_WEBHOOK) {
        try {
            await bot.deleteWebHook();
            await bot.setWebHook(WEBHOOK_URL);
            console.log(`✅ Webhook set to ${WEBHOOK_URL}`);
            
            // Start Express server for webhook
            const app = express();
            app.use(bodyParser.json({ limit: '10mb' }));
            
            app.post('/bot-creator-papa/webhook', (req, res) => {
                try {
                    bot.processUpdate(req.body);
                } catch (error) {
                    console.error('Webhook processing error:', error);
                }
                res.sendStatus(200);
            });
            
            app.listen(3001, () => {
                console.log('✅ Webhook server listening on port 3001');
            });
            
        } catch (error) {
            console.error('Webhook setup failed, falling back to polling:', error);
            bot.startPolling();
        }
    } else {
        console.log('✅ Bot started in polling mode');
    }
    
    // Verify bot startup
    try {
        const me = await bot.getMe();
        console.log(`🤖 Bot ready: @${me.username}`);
        console.log(`📊 Mode: ${USE_WEBHOOK ? 'Webhook' : 'Polling'}`);
        console.log(`🗄️ Database: Connected`);
        console.log(`🔧 Tech Support: @${TECH_SUPPORT_USERNAME}`);
    } catch (error) {
        console.error('❌ Bot startup failed:', error);
        process.exit(1);
    }
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('🛑 Shutting down...');
        await db.close();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('🛑 Shutting down...');
        await db.close();
        process.exit(0);
    });
})();

// Additional callback handlers for better UX
async function handleSettingsMenu(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    const channels = await db.getUserChannels(userId);
    
    if (channels.length === 0) {
        await bot.editMessageText(
            '❌ Anda belum memiliki channel yang terdaftar.\n\n' +
            'Gunakan /setup untuk mendaftarkan channel pertama Anda.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Setup Channel', callback_data: 'setup_start' }],
                        [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
        return;
    }
    
    const keyboard = [
        [{ text: '📊 Kelola Channel', callback_data: 'manage_channels' }],
        [{ text: '🔑 Ubah API Key', callback_data: 'change_api_key' }],
        [{ text: '🆕 Tambah Channel', callback_data: 'setup_start' }],
        [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
    ];
    
    const settingsText = `
⚙️ Pengaturan Bot Creator Papa

Channel Anda:
${channels.map((ch, i) => 
    `${i + 1}. ${ch.channel_title || ch.channel_username}\n` +
    `   Status: ${ch.setup_completed ? '✅ Aktif' : '⚠️ Setup belum selesai'}`
).join('\n')}

Pilih pengaturan yang ingin Anda ubah:
    `;
    
    await bot.editMessageText(settingsText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleManageChannels(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    const channels = await db.getUserChannels(userId);
    
    if (channels.length === 0) {
        await bot.editMessageText(
            '❌ Anda belum memiliki channel yang terdaftar.\n\n' +
            'Gunakan /setup untuk mendaftarkan channel pertama Anda.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Setup Channel', callback_data: 'setup_start' }],
                        [{ text: '🔙 Kembali ke Pengaturan', callback_data: 'settings_menu' }]
                    ]
                }
            }
        );
        return;
    }
    
    const channelText = `
📊 Kelola Channel

Channel Anda:
${channels.map((ch, i) => {
    const username = ch.channel_username.startsWith('@') ? ch.channel_username : `@${ch.channel_username}`;
    return `${i + 1}. ${ch.channel_title || ch.channel_username}\n` +
           `   • Username: ${username}\n` +
           `   • Status: ${ch.setup_completed ? '✅ Aktif' : '⚠️ Setup belum selesai'}\n` +
           `   • API Key: ${ch.api_key ? '🔑 Terpasang' : '❌ Belum ada'}\n`;
}).join('\n')}

Pilih channel untuk dikelola:
    `;
    
    const keyboard = channels.map((channel) => ([
        { text: `⚙️ ${channel.channel_title || channel.channel_username}`, callback_data: `channel_manage_${channel.id}` }
    ]));
    
    keyboard.push(
        [{ text: '🆕 Tambah Channel Baru', callback_data: 'setup_start' }],
        [{ text: '🔙 Kembali ke Pengaturan', callback_data: 'settings_menu' }]
    );
    
    await bot.editMessageText(channelText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleChangeApiKey(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    const channels = await db.getUserChannels(userId);
    
    if (channels.length === 0) {
        await bot.editMessageText(
            '❌ Anda belum memiliki channel yang terdaftar.\n\n' +
            'Gunakan /setup untuk mendaftarkan channel pertama Anda.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Setup Channel', callback_data: 'setup_start' }],
                        [{ text: '🔙 Kembali ke Pengaturan', callback_data: 'settings_menu' }]
                    ]
                }
            }
        );
        return;
    }
    
    const apiKeyText = `
🔑 *Ubah API Key*

*Channel Anda:*
${channels.map((ch, i) => 
    `${i + 1}. *${ch.channel_title || ch.channel_username}*\n` +
    `   • API Key: ${ch.api_key ? '🟢 Aktif' : '🔴 Belum diatur'}\n`
).join('\n')}

Pilih channel untuk mengubah API Key:
    `;
    
    const keyboard = channels.map((channel) => ([
        { text: `🔑 ${channel.channel_title || channel.channel_username}`, callback_data: `api_change_${channel.id}` }
    ]));
    
    keyboard.push([{ text: '🔙 Kembali ke Pengaturan', callback_data: 'settings_menu' }]);
    
    await bot.editMessageText(apiKeyText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function handleHelpMenu(query) {
    const chatId = query.message.chat.id;
    
    const helpText = `
❓ **Bantuan Bot Creator Papa**

**Perintah Utama:**
/start - Mulai menggunakan bot
/setup - Setup channel baru
/settings - Pengaturan channel dan API

**Cara Upload Konten:**
1. Pilih video + gambar thumbnail
2. Kirim bersamaan (media group)
3. Tambahkan caption: #harga#deskripsi
4. Contoh: #15000#Video tutorial menarik!

**Format yang Didukung:**
📹 Video: MP4, AVI, MOV (max 50MB)
🖼️ Gambar: JPG, PNG (untuk thumbnail)

**Dukungan Teknis:**
Hubungi @${TECH_SUPPORT_USERNAME} (${TECH_SUPPORT_DISPLAY_NAME}) untuk bantuan teknis.

**Fitur:**
✅ Multi-channel management
✅ Integrasi pembayaran OY Indonesia
✅ Preview sebelum posting
✅ Sistem keamanan berlapis
    `;
    
    await bot.editMessageText(helpText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
            ]
        }
    });
}

async function handleDonateMenu(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    const donateText = `
☕ **Traktir Kopi Buat Admin**

Terima kasih telah menggunakan Bot Creator Papa! 

Jika bot ini membantu bisnis konten Anda, dukung pengembangan dengan memberikan donasi.

💝 **Donasi membantu:**
• Maintenance server dan database
• Pengembangan fitur baru
• Support teknis 24/7
• Update keamanan

Setiap dukungan sangat berarti untuk kami! 🙏
    `;
    
    await bot.editMessageText(donateText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '💰 Donasi Sekarang', url: process.env.DONATION_URL || 'https://papabadak.carrd.co/' }],
                [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
            ]
        }
    });
    
    await db.logActivity(userId, null, 'donation_view', 'User viewed donation page');
}

async function handleUploadStart(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    const channels = await db.getUserChannels(userId);
    
    if (channels.length === 0) {
        await bot.editMessageText(
            '❌ Anda belum memiliki channel yang terdaftar.\n\n' +
            'Gunakan /setup untuk mendaftarkan channel pertama Anda.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Setup Channel', callback_data: 'setup_start' }],
                        [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
        return;
    }
    
    const uploadText = `
📤 **Upload Konten Baru**

**Cara Upload:**
1. Pilih video dan gambar thumbnail
2. Kirim bersamaan (pilih multiple files)
3. Tambahkan caption dengan format: #harga#deskripsi

**Contoh Caption:**
#15000#Video tutorial Photoshop lengkap!
#25000#Tutorial coding React JS untuk pemula

**Catatan:**
- Harga dalam Rupiah (1000-1000000)
- Video maksimal 50MB
- Gambar untuk thumbnail (opsional tapi direkomendasikan)

Silakan kirim media group Anda sekarang!
    `;
    
    await bot.editMessageText(uploadText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
            ]
        }
    });
}

// Utility function to escape Markdown special characters
function escapeMarkdownV2(text) {
    // Escape characters for MarkdownV2
    return text.toString().replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

async function handleChannelManage(query, channelId) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        const channel = await db.getChannelById(channelId);
        
        if (!channel || channel.user_id !== userId) {
            await bot.editMessageText(
                '❌ Channel tidak ditemukan atau Anda tidak memiliki akses.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Kembali', callback_data: 'manage_channels' }]
                        ]
                    }
                }
            );
            return;
        }
        
        const username = channel.channel_username.startsWith('@') ? channel.channel_username : `@${channel.channel_username}`;
        const channelText = `
⚙️ Kelola Channel: ${channel.channel_title || channel.channel_username}

Informasi Channel:
• Username: ${username}
• Status: ${channel.setup_completed ? '✅ Aktif' : '⚠️ Setup belum selesai'}
• API Key: ${channel.api_key ? '🟢 Terpasang' : '🔴 Belum diatur'}

Pilihan Aksi:
        `;
        
        const keyboard = [
            [{ text: '🔑 Update API Key', callback_data: `api_change_${channelId}` }],
            [{ text: '🗑️ Hapus Channel', callback_data: `channel_delete_${channelId}` }],
            [{ text: '🔙 Kembali', callback_data: 'manage_channels' }]
        ];
        
        await bot.editMessageText(channelText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: keyboard }
        });
        
    } catch (error) {
        console.error('Error in handleChannelManage:', error);
        await bot.editMessageText(
            '❌ Terjadi kesalahan saat memuat informasi channel.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Kembali', callback_data: 'manage_channels' }]
                    ]
                }
            }
        );
    }
}

async function handleApiKeyChange(query, channelId) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        const channel = await db.getChannelById(channelId);
        
        if (!channel || channel.user_id !== userId) {
            await bot.editMessageText(
                '❌ Channel tidak ditemukan atau Anda tidak memiliki akses.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Kembali', callback_data: 'change_api_key' }]
                        ]
                    }
                }
            );
            return;
        }
        
        // Set user session untuk input API key
        userSessions.set(userId, {
            step: 'api_key_input',
            channelId: channelId,
            messageId: query.message.message_id
        });
        
        const apiKeyText = `
🔑 **Update API Key untuk Channel: ${channel.channel_title || channel.channel_username}**

**Status Saat Ini:** ${channel.api_key ? '🟢 API Key sudah terpasang' : '🔴 Belum ada API Key'}

Silakan kirim API Key baru Anda. API Key akan dienkripsi dan disimpan dengan aman.

**Format:** Kirim API Key sebagai pesan teks biasa.

**Catatan:** 
• API Key akan langsung menggantikan yang lama (jika ada)
• Proses ini aman dan terenkripsi
• Ketik /cancel untuk membatalkan
        `;
        
        await bot.editMessageText(apiKeyText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Batal', callback_data: `channel_manage_${channelId}` }]
                ]
            }
        });
        
        await db.logActivity(userId, channelId, 'api_key_change_start', `Started API key change for channel ${channelId}`);
        
    } catch (error) {
        console.error('Error in handleApiKeyChange:', error);
        await bot.editMessageText(
            '❌ Terjadi kesalahan saat memuat informasi channel.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Kembali', callback_data: 'change_api_key' }]
                    ]
                }
            }
        );
    }
}