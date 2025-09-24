class PromoManagement {
    constructor(bot, db, userSessions) {
        this.bot = bot;
        this.db = db;
        this.userSessions = userSessions;
    }

    async showPromoMenu(chatId, userId) {
        // Check if user has channels
        const channels = await this.db.getUserChannels(userId);
        if (channels.length === 0) {
            await this.bot.sendMessage(chatId, 
                '❌ Anda belum memiliki channel yang terdaftar.\n\n' +
                'Gunakan /setup untuk mendaftarkan channel terlebih dahulu.'
            );
            return;
        }
        
        await this.showPromoManagement(chatId, userId, channels);
    }

    async showPromoManagement(chatId, userId, channels) {
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
        
        await this.bot.sendMessage(chatId, promoText, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    async showChannelPromoOptions(query, channelId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        // Get channel info
        const channel = await this.db.getChannelById(channelId);
        if (!channel || channel.user_id !== userId) {
            await this.bot.editMessageText(
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
        
        await this.bot.editMessageText(promoOptionsText, {
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

    async setupDiscountPromo(query, channelId) {
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
        
        await this.bot.editMessageText(discountText, {
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
        this.userSessions.set(userId, {
            step: 'awaiting_discount',
            channelId: channelId,
            messageId: query.message.message_id,
            startTime: Date.now()
        });
    }

    async setupTopupBonusPromo(query, channelId) {
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
        
        await this.bot.editMessageText(topupBonusText, {
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
        this.userSessions.set(userId, {
            step: 'awaiting_topup_bonus',
            channelId: channelId,
            messageId: query.message.message_id,
            startTime: Date.now()
        });
    }

    async handleDiscountInput(msg, session) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const input = msg.text.trim();
        
        // Validate discount percentage
        const discountPercent = parseFloat(input);
        if (isNaN(discountPercent) || discountPercent < 1 || discountPercent > 50) {
            await this.bot.sendMessage(chatId, 
                '❌ Persentase diskon tidak valid!\n\n' +
                'Masukkan angka antara 1-50 (tanpa simbol %).\n' +
                'Contoh: 15 untuk diskon 15%'
            );
            return;
        }
        
        try {
            // Create discount promo
            const promoId = await this.db.createChannelPromo({
                channel_id: session.channelId,
                promo_type: 'discount',
                discount_percentage: discountPercent,
                bonus_min_topup: 0,
                bonus_percentage: 0,
                expires_at: null,
                is_active: true,
                max_uses_per_user: null,
                total_max_uses: null
            });
            
            // Deactivate other discount promos for this channel
            const existingPromos = await this.db.getChannelPromos(session.channelId, false);
            for (const promo of existingPromos) {
                if (promo.id !== promoId && promo.promo_type === 'discount') {
                    await this.db.updateChannelPromo(promo.id, { is_active: false });
                }
            }
            
            await this.db.logActivity(userId, session.channelId, 'promo_created', `Discount promo created: ${discountPercent}%`);
            
            const successMessage = `
🎉 **Promo Diskon Berhasil Dibuat!**

📊 **Diskon:** ${discountPercent}%
🎯 **Berlaku untuk:** Semua video di channel
🕒 **Status:** Aktif sekarang

**Contoh penerapan:**
• Video Rp 15.000 → Rp ${(15000 * (100 - discountPercent) / 100).toLocaleString('id-ID')}
• Video Rp 25.000 → Rp ${(25000 * (100 - discountPercent) / 100).toLocaleString('id-ID')}

Promo akan otomatis diterapkan untuk semua pembelian!
            `;
            
            await this.bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: session.messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 Lihat Semua Promo', callback_data: `promo_view_${session.channelId}` }],
                        [{ text: '🔙 Kembali ke Promo', callback_data: `promo_select_${session.channelId}` }]
                    ]
                }
            });
            
            // Clear session
            this.userSessions.delete(userId);
            
        } catch (error) {
            console.error('Error creating discount promo:', error);
            await this.bot.sendMessage(chatId, 
                '❌ Gagal membuat promo diskon.\n\n' +
                'Terjadi kesalahan sistem. Silakan coba lagi.'
            );
        }
    }

    async handleTopupBonusInput(msg, session) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const input = msg.text.trim();
        
        // Parse input format: minimal_topup,bonus_persen
        const parts = input.split(',');
        if (parts.length !== 2) {
            await this.bot.sendMessage(chatId, 
                '❌ Format tidak valid!\n\n' +
                'Format: minimal_topup,bonus_persen\n' +
                'Contoh: 50000,10'
            );
            return;
        }
        
        const minTopup = parseInt(parts[0].trim());
        const bonusPercent = parseFloat(parts[1].trim());
        
        if (isNaN(minTopup) || minTopup < 10000 || minTopup > 1000000) {
            await this.bot.sendMessage(chatId, 
                '❌ Minimal top-up tidak valid!\n\n' +
                'Masukkan nilai antara 10000-1000000 (Rp 10rb - 1jt)\n' +
                'Contoh: 50000 untuk minimal Rp 50.000'
            );
            return;
        }
        
        if (isNaN(bonusPercent) || bonusPercent < 1 || bonusPercent > 30) {
            await this.bot.sendMessage(chatId, 
                '❌ Persentase bonus tidak valid!\n\n' +
                'Masukkan nilai antara 1-30 (%)\n' +
                'Contoh: 10 untuk bonus 10%'
            );
            return;
        }
        
        try {
            // Create topup bonus promo
            const promoId = await this.db.createChannelPromo({
                channel_id: session.channelId,
                promo_type: 'topup_bonus',
                discount_percentage: 0,
                bonus_min_topup: minTopup,
                bonus_percentage: bonusPercent,
                expires_at: null,
                is_active: true,
                max_uses_per_user: null,
                total_max_uses: null
            });
            
            // Deactivate other topup bonus promos for this channel
            const existingPromos = await this.db.getChannelPromos(session.channelId, false);
            for (const promo of existingPromos) {
                if (promo.id !== promoId && promo.promo_type === 'topup_bonus') {
                    await this.db.updateChannelPromo(promo.id, { is_active: false });
                }
            }
            
            await this.db.logActivity(userId, session.channelId, 'promo_created', `Topup bonus promo created: ${bonusPercent}% for min ${minTopup}`);
            
            const successMessage = `
🎉 **Promo Bonus Top-Up Berhasil Dibuat!**

💰 **Minimal Top-Up:** Rp ${minTopup.toLocaleString('id-ID')}
🎁 **Bonus:** ${bonusPercent}%
🕒 **Status:** Aktif sekarang

**Contoh penerapan:**
• Top-up Rp ${minTopup.toLocaleString('id-ID')} → Dapat Rp ${(minTopup * (100 + bonusPercent) / 100).toLocaleString('id-ID')}
• Top-up Rp ${(minTopup * 2).toLocaleString('id-ID')} → Dapat Rp ${(minTopup * 2 * (100 + bonusPercent) / 100).toLocaleString('id-ID')}

User yang top-up akan otomatis mendapat bonus!
            `;
            
            await this.bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: session.messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 Lihat Semua Promo', callback_data: `promo_view_${session.channelId}` }],
                        [{ text: '🔙 Kembali ke Promo', callback_data: `promo_select_${session.channelId}` }]
                    ]
                }
            });
            
            // Clear session
            this.userSessions.delete(userId);
            
        } catch (error) {
            console.error('Error creating topup bonus promo:', error);
            await this.bot.sendMessage(chatId, 
                '❌ Gagal membuat promo bonus top-up.\n\n' +
                'Terjadi kesalahan sistem. Silakan coba lagi.'
            );
        }
    }

    async showActivePromos(query, channelId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        try {
            const channel = await this.db.getChannelById(channelId);
            if (!channel || channel.user_id !== userId) {
                await this.bot.editMessageText(
                    '❌ Channel tidak ditemukan atau Anda tidak memiliki akses.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id
                    }
                );
                return;
            }
            
            const activePromos = await this.db.getChannelPromos(channelId, true);
            
            if (activePromos.length === 0) {
                await this.bot.editMessageText(
                    `📋 **Promo Aktif: ${channel.channel_title}**\n\n❌ Tidak ada promo yang aktif saat ini.\n\nBuat promo baru untuk menarik lebih banyak pembeli!`,
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🆕 Buat Promo Baru', callback_data: `promo_select_${channelId}` }],
                                [{ text: '🔙 Kembali', callback_data: 'promo_menu' }]
                            ]
                        }
                    }
                );
                return;
            }
            
            let promoText = `📋 **Promo Aktif: ${channel.channel_title}**\n\n`;
            
            for (const promo of activePromos) {
                const createdDate = new Date(promo.created_at).toLocaleDateString('id-ID');
                
                if (promo.promo_type === 'discount') {
                    promoText += `📊 **Diskon Video**\n`;
                    promoText += `   • Diskon: ${promo.discount_percentage}%\n`;
                    promoText += `   • Dibuat: ${createdDate}\n`;
                    promoText += `   • Status: ${promo.is_active ? '✅ Aktif' : '❌ Nonaktif'}\n\n`;
                } else if (promo.promo_type === 'topup_bonus') {
                    promoText += `💰 **Bonus Top-Up**\n`;
                    promoText += `   • Min Top-Up: Rp ${parseInt(promo.bonus_min_topup).toLocaleString('id-ID')}\n`;
                    promoText += `   • Bonus: ${promo.bonus_percentage}%\n`;
                    promoText += `   • Dibuat: ${createdDate}\n`;
                    promoText += `   • Status: ${promo.is_active ? '✅ Aktif' : '❌ Nonaktif'}\n\n`;
                }
            }
            
            const keyboard = [
                [{ text: '🆕 Buat Promo Baru', callback_data: `promo_select_${channelId}` }],
                [{ text: '🔙 Kembali ke Promo', callback_data: `promo_select_${channelId}` }],
                [{ text: '🔙 Kembali ke Menu', callback_data: 'promo_menu' }]
            ];
            
            await this.bot.editMessageText(promoText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
            
        } catch (error) {
            console.error('Error showing active promos:', error);
            await this.bot.editMessageText(
                '❌ Terjadi kesalahan saat memuat promo aktif.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Kembali', callback_data: 'promo_menu' }]
                        ]
                    }
                }
            );
        }
    }
}

module.exports = PromoManagement;