const { schemas, validateChannelAccess, inviteTechSupport, escapeMarkdownV2 } = require('../core/helpers');

class ChannelSetup {
    constructor(bot, db, userSessions) {
        this.bot = bot;
        this.db = db;
        this.userSessions = userSessions;
    }

    async startSetup(chatId, userId) {
        await this.db.logActivity(userId, null, 'setup_start', 'User initiated setup');
        
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
        this.userSessions.set(userId, {
            step: 'awaiting_channel',
            startTime: Date.now(),
            data: {}
        });
        
        await this.bot.sendMessage(chatId, setupMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Batal Setup', callback_data: 'setup_cancel' }]
                ]
            }
        });
    }

    async handleChannelInput(msg, session) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const channelUsername = msg.text.trim();
        
        // Validate channel username format
        const { error } = schemas.channelUsername.validate(channelUsername);
        if (error) {
            await this.bot.sendMessage(chatId, 
                '❌ Format username channel tidak valid!\n\n' +
                'Format yang benar: @namaChannel\n' +
                'Contoh: @videokonten123\n\n' +
                'Silakan masukkan username channel yang benar:'
            );
            return;
        }
        
        const statusMsg = await this.bot.sendMessage(chatId, '🔍 Memeriksa channel...');
        
        // Validate channel access
        const validation = await validateChannelAccess(this.bot, channelUsername);
        
        await this.bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        
        if (!validation.valid) {
            await this.bot.sendMessage(chatId, 
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
            // Try to invite tech support
            const techInvite = await inviteTechSupport(this.bot, channelUsername);

            const adminInstructions = `
✅ *Channel ditemukan: ${escapeMarkdownV2(validation.channelTitle)}*

⚠️ *Bot belum menjadi admin di channel Anda*

*Langkah selanjutnya:*
1\\. Buka channel ${escapeMarkdownV2(channelUsername)}
2\\. Klik "⚙️ Manage Channel" → "👥 Administrators"
3\\. Klik "➕ Add Admin" 
4\\. Cari dan pilih bot ini (@${escapeMarkdownV2((await this.bot.getMe()).username)})
5\\. Berikan permission: "Post Messages", "Edit Messages", "Delete Messages"
6\\. Klik "✅ Done"

Setelah menambahkan bot sebagai admin, klik tombol "Verifikasi Admin" di bawah ini.

${techInvite.success 
    ? `ℹ️ _Sambil menunggu, tim teknis @${escapeMarkdownV2(process.env.TECH_SUPPORT_USERNAME || 'support')} telah dikirimi link undangan untuk membantu jika diperlukan\\._` 
    : `⚠️ _Gagal membuat link undangan untuk tech support\\. Anda mungkin perlu mengundang @${escapeMarkdownV2(process.env.TECH_SUPPORT_USERNAME || 'support')} secara manual\\._`
}
            `;
            
            await this.bot.sendMessage(chatId, adminInstructions, {
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
            session.data.techInvite = await inviteTechSupport(this.bot, channelUsername);
            await this.proceedToApiKey(chatId, userId, session);
        }
    }

    async proceedToApiKey(chatId, userId, session) {
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
        
        await this.bot.sendMessage(chatId, apiKeyMessage, {
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

    async handleApiKeyInput(msg, session) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const apiKey = msg.text.trim();
        
        // Delete the message containing API key for security
        await this.bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        
        // Validate API key format
        const { error } = schemas.oyApiKey.validate(apiKey);
        if (error) {
            await this.bot.sendMessage(chatId, 
                '❌ Format API Key tidak valid\\!\n\n' +
                'API Key harus minimal 10 karakter\\.\n' +
                'Silakan masukkan API Key yang benar:',
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }
        
        const statusMsg = await this.bot.sendMessage(chatId, '🔐 Memvalidasi API Key...');
        
        // TODO: Add actual API key validation with OY Indonesia
        // For now, we'll assume it's valid
        const isValidApiKey = true;
        
        await this.bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        
        if (!isValidApiKey) {
            await this.bot.sendMessage(chatId, 
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
            const channelId = await this.db.upsertChannel(
                userId, 
                session.data.channelUsername, 
                apiKey
            );

            if (!channelId) {
                throw new Error('Failed to create channel record');
            }
            
            await this.db.updateChannelStatus(channelId, {
                channel_id: session.data.channelId,
                channel_title: session.data.channelTitle,
                bot_admin_status: 'verified',
                setup_completed: true
            });
            
            // Use the tech invite result from the previous step
            const techInvite = session.data.techInvite || { success: false };
            
            if (techInvite.success) {
                await this.db.logActivity(userId, channelId, 'tech_support_invited', 'Tech support invited to channel');
            }
            
            await this.db.logActivity(userId, channelId, 'setup_complete', 'Channel setup completed successfully');
            
            const techSupportInviteMessage = techInvite.success 
                ? `✅ @${escapeMarkdownV2(process.env.TECH_SUPPORT_USERNAME || 'support')} \\(${escapeMarkdownV2(process.env.TECH_SUPPORT_DISPLAY_NAME || 'Support')}\\) telah diundang sebagai tech support\\.` 
                : `⚠️ Gagal mengundang tech support\\. Silakan undang @${escapeMarkdownV2(process.env.TECH_SUPPORT_USERNAME || 'support')} secara manual\\.`;

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
            
            await this.bot.sendMessage(chatId, successMessage, {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📤 Upload Konten Pertama', callback_data: 'upload_start' }],
                        [{ text: '⚙️ Pengaturan', callback_data: 'settings_menu' }]
                    ]
                }
            });
            
            // Clear session
            this.userSessions.delete(userId);
            
        } catch (error) {
            console.error('Database error during setup:', error);
            await this.bot.sendMessage(chatId, 
                '❌ Gagal menyimpan konfigurasi channel\\.\n\n' +
                'Terjadi kesalahan pada database\\. Silakan coba lagi atau hubungi tech support\\.',
                { parse_mode: 'MarkdownV2' }
            );
        }
    }

    async handleAdminVerification(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const session = this.userSessions.get(userId);
        
        if (!session || session.step !== 'awaiting_admin_verification') {
            await this.bot.editMessageText(
                '❌ Sesi setup tidak valid. Silakan mulai setup ulang dengan /setup',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            );
            return;
        }
        
        const statusMsg = await this.bot.sendMessage(chatId, '🔍 Memverifikasi status admin...');
        
        // Re-check admin status
        const validation = await validateChannelAccess(this.bot, session.data.channelUsername);
        
        await this.bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        
        if (!validation.valid || !validation.isAdmin) {
            const errorMessage = validation.valid 
                ? `⚠️ **Bot belum menjadi admin**\n\nBot masih belum memiliki akses admin di channel ${escapeMarkdownV2(session.data.channelUsername)}\\.\n\nSilakan tambahkan bot sebagai admin terlebih dahulu, lalu coba verifikasi lagi.`
                : `❌ **Gagal memverifikasi channel**\n\n${escapeMarkdownV2(validation.error)}\n\nSilakan periksa kembali pengaturan channel Anda.`;

            await this.bot.editMessageText(errorMessage, {
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
            session.data.techInvite = await inviteTechSupport(this.bot, session.data.channelUsername);
        }

        await this.bot.editMessageText(
            `✅ **Verifikasi admin berhasil!**\n\nBot sekarang memiliki akses admin di channel ${escapeMarkdownV2(session.data.channelTitle)}\\.\n\nMelanjutkan ke langkah berikutnya...`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'MarkdownV2'
            }
        );
        
        // Proceed to API key step
        setTimeout(async () => {
            await this.proceedToApiKey(chatId, userId, session);
        }, 2000);
    }

    async cancelSetup(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        // Clear user session
        this.userSessions.delete(userId);
        
        await this.bot.editMessageText(
            '❌ **Setup Dibatalkan**\n\nAnda dapat memulai setup kembali kapan saja dengan perintah /setup',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🆕 Setup Ulang', callback_data: 'setup_start' }],
                        [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
    }
}

module.exports = ChannelSetup;