const { schemas, escapeMarkdownV2 } = require('../core/helpers');

class Settings {
    constructor(bot, db, userSessions) {
        this.bot = bot;
        this.db = db;
        this.userSessions = userSessions;
    }

    async showSettingsMenu(chatId, userId) {
        const channels = await this.db.getUserChannels(userId);
        
        if (channels.length === 0) {
            await this.bot.sendMessage(chatId, 
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
        
        await this.bot.sendMessage(chatId, settingsText, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    async handleManageChannels(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        const channels = await this.db.getUserChannels(userId);
        
        if (channels.length === 0) {
            await this.bot.editMessageText(
                '❌ **Tidak ada channel terdaftar**\n\nSilakan setup channel terlebih dahulu dengan /setup',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🆕 Setup Channel', callback_data: 'setup_start' }],
                            [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
            return;
        }
        
        const channelText = `
📊 **Kelola Channel**

**Channel Anda:**
${channels.map((ch, i) => {
    const statusIcon = ch.setup_completed ? '✅' : '⚠️';
    const status = ch.setup_completed ? 'Aktif' : 'Setup belum selesai';
    return `${i + 1}. ${ch.channel_title || ch.channel_username}\n   ${statusIcon} ${status}`;
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
        
        await this.bot.editMessageText(channelText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    async handleChannelManage(query, channelId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        try {
            const channel = await this.db.getChannelById(channelId);
            
            if (!channel || channel.user_id !== userId) {
                await this.bot.editMessageText(
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
            const setupStatus = channel.setup_completed ? '✅ Lengkap' : '⚠️ Belum selesai';
            const apiKeyStatus = channel.api_key ? '🟢 Aktif' : '🔴 Belum diatur';
            
            const manageText = `
⚙️ **Kelola Channel**

**Informasi Channel:**
📺 **Nama:** ${channel.channel_title || 'Tidak diketahui'}
🆔 **Username:** ${username}
🔧 **Setup:** ${setupStatus}
🔑 **API Key:** ${apiKeyStatus}

**Aksi yang tersedia:**
            `;
            
            const keyboard = [
                [{ text: '🔑 Update API Key', callback_data: `api_change_${channelId}` }],
                [{ text: '📊 Lihat Statistik', callback_data: `stats_${channelId}` }],
                [{ text: '🗑️ Hapus Channel', callback_data: `delete_${channelId}` }],
                [{ text: '🔙 Kembali', callback_data: 'manage_channels' }]
            ];
            
            await this.bot.editMessageText(manageText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
            
        } catch (error) {
            console.error('Error in handleChannelManage:', error);
            await this.bot.editMessageText(
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

    async handleChangeApiKey(query) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        const channels = await this.db.getUserChannels(userId);
        
        if (channels.length === 0) {
            await this.bot.editMessageText(
                '❌ **Tidak ada channel terdaftar**\n\nSilakan setup channel terlebih dahulu dengan /setup',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🆕 Setup Channel', callback_data: 'setup_start' }],
                            [{ text: '🔙 Kembali', callback_data: 'settings_menu' }]
                        ]
                    }
                }
            );
            return;
        }
        
        const apiKeyText = `
🔑 **Ubah API Key**

**Channel Anda:**
${channels.map((ch, i) => 
    `${i + 1}. **${ch.channel_title || ch.channel_username}**\n` +
    `   • API Key: ${ch.api_key ? '🟢 Aktif' : '🔴 Belum diatur'}\n`
).join('\n')}

Pilih channel untuk mengubah API Key:
        `;
        
        const keyboard = channels.map((channel) => ([
            { text: `🔑 ${channel.channel_title || channel.channel_username}`, callback_data: `api_change_${channel.id}` }
        ]));
        
        keyboard.push([{ text: '🔙 Kembali ke Pengaturan', callback_data: 'settings_menu' }]);
        
        await this.bot.editMessageText(apiKeyText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    async handleApiKeyChange(query, channelId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        try {
            const channel = await this.db.getChannelById(channelId);
            
            if (!channel || channel.user_id !== userId) {
                await this.bot.editMessageText(
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
            
            const updateText = `
🔑 **Update API Key**

**Channel:** ${channel.channel_title || channel.channel_username}
**Username:** ${channel.channel_username}

Masukkan API Key baru dari OY Indonesia:

**Keamanan:**
✅ API Key akan dienkripsi
✅ Pesan Anda akan dihapus otomatis
✅ Akses hanya untuk channel ini

Kirim API Key sekarang:
            `;
            
            await this.bot.editMessageText(updateText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❓ Cara Mendapat API Key', url: 'https://docs.oyindonesia.com/' }],
                        [{ text: '🔙 Batal', callback_data: `channel_manage_${channelId}` }]
                    ]
                }
            });
            
            // Set session for API key input
            this.userSessions.set(userId, {
                step: 'api_key_input',
                channelId: channelId,
                messageId: query.message.message_id,
                startTime: Date.now()
            });
            
        } catch (error) {
            console.error('Error in handleApiKeyChange:', error);
            await this.bot.editMessageText(
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

    async handleApiKeyUpdate(msg, session) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const apiKey = msg.text.trim();
        
        // Delete the message containing API key for security
        await this.bot.deleteMessage(chatId, msg.message_id).catch(() => {});
        
        // Validate API key format
        const { error } = schemas.oyApiKey.validate(apiKey);
        if (error) {
            await this.bot.sendMessage(chatId, 
                '❌ Format API Key tidak valid!\n\n' +
                'API Key harus minimal 10 karakter.\n' +
                'Silakan masukkan API Key yang benar:'
            );
            return;
        }
        
        const statusMsg = await this.bot.sendMessage(chatId, '🔐 Memperbarui API Key...');
        
        try {
            // Update API key in database
            await this.db.updateChannelApiKey(session.channelId, apiKey);
            
            // Get channel info
            const channel = await this.db.getChannelById(session.channelId);
            
            await this.bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
            
            const successMessage = `
🎉 **API Key Berhasil Diperbarui!**

**Channel:** ${channel.channel_title || channel.channel_username}
**Status:** ✅ API Key baru telah tersimpan dengan aman

API Key telah dienkripsi dan disimpan dalam database. Channel Anda siap untuk menerima pembayaran.
            `;
            
            // Update the original message
            await this.bot.editMessageText(successMessage, {
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
            
            await this.db.logActivity(userId, session.channelId, 'api_key_updated', 'API key updated successfully');
            
            // Clear session
            this.userSessions.delete(userId);
            
        } catch (error) {
            console.error('Error updating API key:', error);
            
            await this.bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
            
            await this.bot.sendMessage(chatId, 
                '❌ Gagal memperbarui API Key.\n\n' +
                'Terjadi kesalahan pada database. Silakan coba lagi atau hubungi tech support.'
            );
        }
    }

    async handleChannelDelete(query, channelId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        try {
            const channel = await this.db.getChannelById(channelId);
            
            if (!channel || channel.user_id !== userId) {
                await this.bot.editMessageText(
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
⚠️ **Konfirmasi Hapus Channel**

**Channel:** ${channel.channel_title || channel.channel_username}
**Username:** ${username}

**PERINGATAN:**
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
            
            await this.bot.editMessageText(confirmText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
            
        } catch (error) {
            console.error('Error in handleChannelDelete:', error);
            await this.bot.editMessageText(
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

    async handleChannelDeleteConfirm(query, channelId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        try {
            const channel = await this.db.getChannelById(channelId);
            
            if (!channel || channel.user_id !== userId) {
                await this.bot.editMessageText(
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
            
            await this.bot.editMessageText(
                '🗑️ Menghapus channel dan semua data terkait...',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            );
            
            // Log activity BEFORE deleting channel
            await this.db.logActivity(userId, null, 'channel_deleted', `Channel ${channel.channel_username} deleted by user`);
            
            // Delete channel from database
            await this.db.deleteChannel(channelId);
            
            const successText = `
✅ **Channel Berhasil Dihapus**

**Channel:** ${channel.channel_title || channel.channel_username}

Semua data channel telah dihapus permanen dari sistem.

**Yang telah dihapus:**
• Data channel dan konfigurasi
• Semua konten yang diupload
• Log aktivitas terkait channel
• API key yang tersimpan

Anda dapat menambahkan channel baru kapan saja melalui menu setup.
            `;
            
            await this.bot.editMessageText(successText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
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
            await this.bot.editMessageText(
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
}

module.exports = Settings;