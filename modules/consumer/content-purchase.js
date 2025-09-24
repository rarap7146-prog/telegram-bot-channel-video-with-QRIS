class ContentPurchase {
    constructor(bot, db, userSessions, qrisHandler) {
        this.bot = bot;
        this.db = db;
        this.userSessions = userSessions;
        this.qrisHandler = qrisHandler;
    }

    // Helper method to edit message text or caption depending on message type
    async editMessage(text, options) {
        const { chat_id, message_id, parse_mode, reply_markup } = options;
        
        try {
            // Try to get the message to check its type
            const message = options.message || await this.bot.getChat(chat_id);
            
            // If the callback query contains a message, check if it has a photo
            if (options.query && options.query.message && options.query.message.photo) {
                return await this.bot.editMessageCaption(text, {
                    chat_id,
                    message_id,
                    parse_mode,
                    reply_markup
                });
            } else {
                return await this.bot.editMessageText(text, {
                    chat_id,
                    message_id,
                    parse_mode,
                    reply_markup
                });
            }
        } catch (error) {
            // If editing fails, try the alternative method
            try {
                if (error.description && error.description.includes('no text in the message')) {
                    return await this.bot.editMessageCaption(text, {
                        chat_id,
                        message_id,
                        parse_mode,
                        reply_markup
                    });
                } else {
                    return await this.bot.editMessageText(text, {
                        chat_id,
                        message_id,
                        parse_mode,
                        reply_markup
                    });
                }
            } catch (secondError) {
                console.error('Failed to edit message:', secondError);
                throw secondError;
            }
        }
    }

    async handleContentDeepLink(chatId, userId, contentId) {
        try {
            // Ensure user exists in database first
            await this.db.createOrUpdateUser({
                id: userId,
                username: '',
                first_name: '',
                last_name: ''
            });

            // Get content details from creator database
            const content = await this.getContentFromCreatorDB(contentId);
            if (!content) {
                await this.bot.sendMessage(chatId, 
                    '❌ **Konten tidak ditemukan**\n\n' +
                    'Maaf, konten yang Anda cari tidak tersedia atau telah dihapus.',
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            // Get user's data and channel-specific balance from consumer database
            const userRow = await this.db.getUserById(userId);
            const channelBalance = await this.db.getUserChannelBalance(userId, content.channel_id);
            const userBalance = channelBalance ? parseFloat(channelBalance) : 0;

            // Check if user already purchased this content
            const existingPurchase = await this.checkExistingPurchase(userId, contentId);
            if (existingPurchase) {
                return await this.deliverPurchasedContent(chatId, userId, content, existingPurchase);
            }

            // Calculate prices
            const originalPrice = parseFloat(content.base_price_idr);
            const discountPrice = await this.calculateDiscountPrice(content.channel_id, originalPrice);
            const finalPrice = discountPrice || originalPrice;
            const hasDiscount = discountPrice && discountPrice < originalPrice;

            // Format price display
            const formatCurrency = (amount) => new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
            }).format(amount);

            // Create purchase message
            const purchaseText = `
🎬 **${content.caption}**

📺 **Channel:** ${content.channel_title || content.channel_username}
⏱️ **Durasi:** ${Math.floor(content.video_duration / 60)}m ${content.video_duration % 60}s

💰 **Harga Asli:** ${formatCurrency(originalPrice)}
${hasDiscount ? `🎉 **Harga Diskon:** ${formatCurrency(finalPrice)}` : '➖ **Diskon:** -'}

💳 **Saldo Anda:** ${formatCurrency(userBalance)}
            `;

            const keyboard = [
                [{ text: '🎬 Beli Video Ini', callback_data: `purchase_content_${contentId}` }],
                [{ text: '💳 Top-up Saldo', callback_data: 'topup_balance' }]
            ];

            // Send content preview with thumbnail if available
            if (content.image_file_id) {
                await this.bot.sendPhoto(chatId, content.image_file_id, {
                    caption: purchaseText,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            } else {
                await this.bot.sendMessage(chatId, purchaseText, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            }

            // Log activity
            await this.logActivity(userId, 'content_view', 'User viewed content purchase page', {
                content_id: contentId,
                original_price: originalPrice,
                final_price: finalPrice,
                user_balance: userBalance
            });

        } catch (error) {
            console.error('Error handling content deep link:', error);
            await this.bot.sendMessage(chatId, 
                '❌ **Terjadi kesalahan**\n\n' +
                'Maaf, terjadi kesalahan saat memuat konten. Silakan coba lagi.',
                { parse_mode: 'Markdown' }
            );
        }
    }

    async handleContentPurchase(query, contentId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        try {
            await this.bot.answerCallbackQuery(query.id, {
                text: '🔄 Memproses pembelian...'
            });

            // Get content and user details
            const content = await this.getContentFromCreatorDB(contentId);
            const userRow = await this.db.getUserById(userId);

            if (!content) {
                await this.editMessage(
                    '❌ **Konten tidak ditemukan**\n\nKonten mungkin sudah dihapus.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        query: query
                    }
                );
                return;
            }

            // Calculate final price
            const originalPrice = parseFloat(content.base_price_idr);
            const discountPrice = await this.calculateDiscountPrice(content.channel_id, originalPrice);
            const finalPrice = discountPrice || originalPrice;
            const channelBalance = await this.db.getUserChannelBalance(userId, content.channel_id);
            const userBalance = channelBalance ? parseFloat(channelBalance) : 0;

            // Show purchase options instead of automatically processing
            await this.showPurchaseOptions(query, content, finalPrice, userBalance);

        } catch (error) {
            console.error('Error processing content purchase:', error);
            await this.editMessage(
                '❌ **Terjadi kesalahan**\n\nGagal memproses pembelian. Silakan coba lagi.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    query: query
                }
            );
        }
    }

    async showPurchaseOptions(query, content, finalPrice, userBalance) {
        const chatId = query.message.chat.id;
        const formatCurrency = (amount) => new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(amount);

        let message = `🎬 **${content.caption || 'Video Premium'}**\n\n`;
        message += `💰 **Harga:** ${formatCurrency(finalPrice)}\n`;
        message += `💳 **Saldo Anda:** ${formatCurrency(userBalance)}\n\n`;

        // EXACTLY 2 BUTTONS as you requested
        const keyboard = [
            [
                { text: '🎬 Lanjutkan Beli', callback_data: `buy_video_${content.id}` }
            ],
            [
                { text: '💳 Top-up Saldo', callback_data: `topup_balance_${content.id}` }
            ]
        ];

        await this.editMessage(message, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
            query: query
        });
    }

    async handleBalancePurchase(query, contentId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        try {
            await this.bot.answerCallbackQuery(query.id, {
                text: '💳 Memproses pembayaran dengan saldo...'
            });

            // Get content details and user balance
            const content = await this.getContentFromCreatorDB(contentId);
            const userRow = await this.db.getUserById(userId);

            if (!content) {
                await this.editMessage(
                    '❌ **Konten tidak ditemukan**\n\nKonten mungkin sudah dihapus.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        query: query
                    }
                );
                return;
            }

            // Calculate final price
            const originalPrice = parseFloat(content.base_price_idr);
            const discountPrice = await this.calculateDiscountPrice(content.channel_id, originalPrice);
            const finalPrice = discountPrice || originalPrice;
            const channelBalance = await this.db.getUserChannelBalance(userId, content.channel_id);
            const userBalance = channelBalance ? parseFloat(channelBalance) : 0;

            if (userBalance < finalPrice) {
                await this.editMessage(
                    '❌ **Saldo tidak mencukupi**\n\nSilakan isi saldo atau pilih metode pembayaran lain.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        query: query
                    }
                );
                return;
            }

            // Process balance payment
            return await this.processBalancePurchase(query, content, finalPrice, userBalance);

        } catch (error) {
            console.error('Error processing balance purchase:', error);
            await this.editMessage(
                '❌ **Terjadi kesalahan**\n\nGagal memproses pembayaran. Silakan coba lagi.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    query: query
                }
            );
        }
    }

    async processBalancePurchase(query, content, finalPrice, userBalance) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        try {
            // 1) Check if user already owns this content
            const existing = await this.checkExistingPurchase(userId, content.id);
            if (existing) {
                await this.editMessage(
                    '✅ **Anda sudah memiliki konten ini!**\n\nKonten akan dikirim ulang.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        query: query
                    }
                );
                // Re-send privately using the unified sender
                await this.qrisHandler.sendContentToUser(userId, content.id);
                return;
            }

            // 2) Attempt to deduct channel-specific balance atomically
            const deducted = await this.db.deductUserChannelBalance(userId, content.channel_id, finalPrice);
            if (!deducted) {
                await this.editMessage(
                    '❌ **Saldo tidak mencukupi**\n\nSilakan isi saldo atau pilih metode pembayaran lain.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        query: query
                    }
                );
                return;
            }

            // 3) Record grant & transaction
            const purchaseRef = `bal_${Date.now()}_${userId}`;
            await this.db.grantContentAccess(userId, content.id, finalPrice);
            await this.db.recordPurchaseTransaction(userId, content.id, finalPrice, 'balance');

            // 4) Log activity
            await this.logActivity(userId, 'balance_purchase', 'Content purchased with balance', {
                content_id: content.id,
                amount: finalPrice,
                purchase_ref: purchaseRef
            });

            // 5) Deliver content (use unified delivery wrapper)
            await this.deliverContent(chatId, userId, content, purchaseRef);

            // 6) Edit message to confirm success
            await this.editMessage(
                '✅ **Pembelian berhasil! Konten telah dikirim ke chat pribadi Anda.**',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    query: query
                }
            );

        } catch (error) {
            console.error('Error processing balance purchase:', error);
            await this.editMessage(
                '❌ **Gagal memproses pembayaran**\n\nTerjadi kesalahan sistem. Silakan coba lagi.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    query: query
                }
            );
        }
    }

    async generatePaymentQRIS(query, content, finalPrice, userBalance) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        // Create payment session
        const paymentId = `pay_${userId}_${content.id}_${Date.now()}`;
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Store payment session
        this.userSessions.set(`payment_${paymentId}`, {
            user_id: userId,
            content_id: content.id,
            amount: finalPrice,
            expires_at: expiresAt,
            created_at: new Date()
        });

        const formatCurrency = (amount) => new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(amount);

        // Generate mock QRIS (in real implementation, this would call OY Indonesia API)
        const qrisCaption = `
🔰 **QRIS Pembayaran**

🎬 **Konten:** ${content.caption}
💰 **Jumlah:** ${formatCurrency(finalPrice)}
💳 **Saldo Anda:** ${formatCurrency(userBalance)}
🆔 **ID Transaksi:** \`${paymentId}\`

⏰ **Bayar dalam 10 menit**
📱 Scan QR code di atas untuk melakukan pembayaran

💡 **Pastikan jumlah pembayaran tepat:** ${formatCurrency(finalPrice)}
        `;

        // For now, send a mock QRIS image (you would replace this with actual QRIS generation)
        const mockQRISUrl = 'https://via.placeholder.com/300x300.png?text=QRIS+Payment'; // Replace with actual QRIS

        await this.editMessage(
            qrisCaption,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                query: query,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Saya Sudah Bayar', callback_data: `confirm_payment_${paymentId}` }],
                        [{ text: '❌ Batal', callback_data: `cancel_payment_${paymentId}` }]
                    ]
                }
            }
        );

        // Send QRIS image
        await this.bot.sendPhoto(chatId, mockQRISUrl, {
            caption: `🔰 **Scan QR Code ini untuk pembayaran**\n\n💰 **Jumlah:** ${formatCurrency(finalPrice)}\n⏰ **Berlaku hingga:** ${expiresAt.toLocaleTimeString('id-ID')}`,
            parse_mode: 'Markdown'
        });

        // Log payment initiation
        await this.logActivity(userId, 'payment_initiated', 'User initiated QRIS payment', {
            payment_id: paymentId,
            content_id: content.id,
            amount: finalPrice
        });
    }

    async handlePaymentConfirmation(query, paymentId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        try {
            // Get payment session
            const paymentSession = this.userSessions.get(`payment_${paymentId}`);
            if (!paymentSession) {
                await this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Sesi pembayaran tidak ditemukan atau sudah kadaluarsa',
                    show_alert: true
                });
                return;
            }

            // Check if payment expired
            if (new Date() > paymentSession.expires_at) {
                await this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Pembayaran sudah kadaluarsa',
                    show_alert: true
                });
                this.userSessions.delete(`payment_${paymentId}`);
                return;
            }

            // For now, we'll mock the payment verification (always success)
            // In real implementation, this would verify with OY Indonesia API
            const paymentVerified = true; // Mock verification

            if (!paymentVerified) {
                await this.bot.answerCallbackQuery(query.id, {
                    text: '❌ Pembayaran belum terverifikasi. Silakan coba lagi.',
                    show_alert: true
                });
                return;
            }

            // Payment successful - process the purchase
            await this.bot.answerCallbackQuery(query.id, {
                text: '✅ Pembayaran berhasil! Memproses konten...'
            });

            // Get content details
            const content = await this.getContentFromCreatorDB(paymentSession.content_id);
            if (!content) {
                await this.editMessage(
                    '❌ **Konten tidak ditemukan**\n\nTerjadi kesalahan sistem.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        query: query
                    }
                );
                return;
            }

            // Record purchase
            await this.recordContentPurchase(userId, content, paymentSession.amount, paymentId);

            // Show loading message
            const loadingMsg = await this.editMessage(
                '📤 **Mengirim konten...**\n\nMohon tunggu sebentar...',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    query: query
                }
            );

            // Deliver content
            await this.deliverContent(chatId, userId, content, paymentId);

            // Delete loading message
            setTimeout(async () => {
                await this.bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
            }, 2000);

            // Clean up payment session
            this.userSessions.delete(`payment_${paymentId}`);

        } catch (error) {
            console.error('Error confirming payment:', error);
            await this.bot.answerCallbackQuery(query.id, {
                text: '❌ Terjadi kesalahan saat memproses pembayaran',
                show_alert: true
            });
        }
    }

    async deliverContent(chatId, userId, content, purchaseRef) {
        const formatCurrency = (amount) => new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(amount);

        const deliveryCaption = `
🎉 **Pembelian Berhasil!**

🎬 **${content.caption}**
💰 **Harga:** ${formatCurrency(content.base_price_idr)}
📅 **Dibeli:** ${new Date().toLocaleDateString('id-ID')}

✅ **Terima kasih atas pembeliannya!**
        `;
        // Prefer using the centralized QRIS handler sender to keep delivery consistent
        try {
            if (this.qrisHandler && typeof this.qrisHandler.sendContentToUser === 'function') {
                await this.qrisHandler.sendContentToUser(userId, content.id);
            } else {
                // Fallback to local sending logic
                if (content.video_file_id) {
                    await this.bot.sendVideo(userId, content.video_file_id, {
                        caption: deliveryCaption,
                        parse_mode: 'Markdown'
                    });
                } else {
                    await this.bot.sendMessage(userId, deliveryCaption, { parse_mode: 'Markdown' });
                }
            }
        } catch (err) {
            console.error('Primary delivery failed, falling back to local method:', err);
            if (content.video_file_id) {
                try {
                    await this.bot.sendVideo(userId, content.video_file_id, {
                        caption: deliveryCaption,
                        parse_mode: 'Markdown'
                    });
                } catch (videoError) {
                    console.error('Fallback video send failed:', videoError);
                    await this.bot.sendMessage(userId, deliveryCaption + '\n\n⚠️ **Video sedang diproses** - akan dikirim segera oleh admin.', { parse_mode: 'Markdown' });
                }
            } else {
                await this.bot.sendMessage(userId, deliveryCaption + '\n\n⚠️ **Konten akan dikirim segera** oleh admin.', { parse_mode: 'Markdown' });
            }
        }

        // Log successful delivery
        await this.logActivity(userId, 'content_delivered', 'Content successfully delivered to user', {
            content_id: content.id,
            purchase_ref: purchaseRef
        });
    }

    // Helper methods that will need to be implemented based on your database structure
    async getContentFromCreatorDB(contentId) {
        // This will query the creator database for content details
        // Implementation depends on your database structure
        try {
            const query = `
                SELECT mc.*, c.channel_username, c.channel_title, 
                       u.username as creator_username, u.first_name as creator_name
                FROM media_content mc
                JOIN channels c ON mc.channel_id = c.id
                JOIN users u ON c.user_id = u.id
                WHERE mc.id = ? AND mc.post_status = 'published'
            `;
            const [rows] = await this.db.pool.execute(query, [contentId]);
            return rows[0] || null;
        } catch (error) {
            console.error('Error getting content from creator DB:', error);
            return null;
        }
    }

    async getUserFromConsumerDB(userId) {
        // Retrieve user record from consumer database
        try {
            return await this.db.getUserById(userId);
        } catch (error) {
            console.error('Error fetching user from consumer DB:', error);
            return null;
        }
    }

    async calculateDiscountPrice(channelId, originalPrice) {
        // This will check for active discounts on the channel
        // For now, return null (no discount)
        return null;
    }

    async checkExistingPurchase(userId, contentId) {
        try {
            const query = `SELECT * FROM content_purchases WHERE user_id = ? AND content_id = ? AND status = 'completed' LIMIT 1`;
            const [rows] = await this.db.pool.execute(query, [userId, contentId]);
            return rows[0] || null;
        } catch (error) {
            console.error('Error checking existing purchase:', error);
            return null;
        }
    }

    async recordContentPurchase(userId, content, amount, paymentRef) {
        try {
            await this.db.grantContentAccess(userId, content.id, amount);
            await this.db.recordPurchaseTransaction(userId, content.id, amount, paymentRef || 'balance');
        } catch (error) {
            console.error('Error recording content purchase:', error);
        }
    }

    async logActivity(userId, action, description, metadata) {
        // Log user activity
        console.log(`Activity: ${userId} - ${action} - ${description}`, metadata);
    }

    async deliverPurchasedContent(chatId, userId, content, existingPurchase) {
        await this.bot.sendMessage(chatId, 
            '✅ **Konten sudah terbeli!**\n\n📥 Mengirim konten sekarang...',
            { parse_mode: 'Markdown' }
        );

        await this.deliverContent(chatId, userId, content, existingPurchase.id);
    }

    // QRIS Integration Methods
    async handleCreateQRISTopup(query, amount, pendingContentId = null) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        try {
            // Delete confirmation message
            await this.bot.deleteMessage(chatId, query.message.message_id);

            // Show loading message
            const loadingMsg = await this.bot.sendMessage(chatId, 
                '⏳ Membuat QRIS pembayaran...\n\nMohon tunggu sebentar.'
            );

            // Generate QRIS for top-up with pending content context
            const qrisResult = await this.qrisHandler.generateQRISForTopup(chatId, userId, amount, null, pendingContentId);

            // Delete loading message
            await this.bot.deleteMessage(chatId, loadingMsg.message_id);

            if (!qrisResult) {
                await this.bot.sendMessage(chatId, 
                    '❌ Gagal membuat QRIS. Silakan coba lagi atau hubungi support.'
                );
            }

        } catch (error) {
            console.error('Error creating QRIS top-up:', error);
            await this.bot.sendMessage(chatId, 
                '❌ Terjadi kesalahan saat membuat QRIS. Silakan coba lagi.'
            );
        }
    }

    async handleQRISContentPayment(query, contentId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        try {
            // Get content details
            const content = await this.getContentFromCreatorDB(contentId);
            if (!content) {
                await this.bot.answerCallbackQuery(query.id, { text: 'Konten tidak ditemukan' });
                return;
            }

            // Show confirmation
            const originalPrice = parseFloat(content.base_price_idr);
            const discountPrice = await this.calculateDiscountPrice(content.channel_id, originalPrice);
            const finalPrice = discountPrice || originalPrice;

            const formatCurrency = (amount) => new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
            }).format(amount);

            const confirmMessage = `🎬 **Konfirmasi Pembelian**\n\n` +
                                 `📹 **Konten:** ${content.caption || 'Video Premium'}\n` +
                                 `💰 **Harga:** ${formatCurrency(finalPrice)}\n` +
                                 `⚡ **Metode:** QRIS (semua e-wallet)\n` +
                                 `⏰ **Berlaku:** 10 menit\n\n` +
                                 `Lanjut membuat QRIS pembayaran?`;

            const keyboard = [
                [{ text: '✅ Buat QRIS', callback_data: `create_qris_content_${contentId}` }],
                [{ text: '❌ Batal', callback_data: 'cancel_purchase' }]
            ];

            await this.editMessage(confirmMessage, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard },
                query: query
            });

        } catch (error) {
            console.error('Error in handleQRISContentPayment:', error);
            await this.bot.answerCallbackQuery(query.id, { text: 'Terjadi kesalahan' });
        }
    }

    async handleCreateQRISContent(query, contentId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;

        try {
            // Get content details
            const content = await this.getContentFromCreatorDB(contentId);
            if (!content) {
                await this.bot.answerCallbackQuery(query.id, { text: 'Konten tidak ditemukan' });
                return;
            }

            // Calculate final price
            const originalPrice = parseFloat(content.base_price_idr);
            const discountPrice = await this.calculateDiscountPrice(content.channel_id, originalPrice);
            const finalPrice = discountPrice || originalPrice;

            // Delete confirmation message
            await this.bot.deleteMessage(chatId, query.message.message_id);

            // Show loading message
            const loadingMsg = await this.bot.sendMessage(chatId, 
                '⏳ Membuat QRIS pembayaran...\n\nMohon tunggu sebentar.'
            );

            // Generate QRIS for content purchase
            const qrisResult = await this.qrisHandler.generateQRISForContent(
                chatId, userId, contentId, finalPrice
            );

            // Delete loading message
            await this.bot.deleteMessage(chatId, loadingMsg.message_id);

            if (!qrisResult) {
                await this.bot.sendMessage(chatId, 
                    '❌ Gagal membuat QRIS. Silakan coba lagi atau hubungi support.'
                );
            }

        } catch (error) {
            console.error('Error creating QRIS for content:', error);
            await this.bot.sendMessage(chatId, 
                '❌ Terjadi kesalahan saat membuat QRIS. Silakan coba lagi.'
            );
        }
    }

    async handleCheckPaymentStatus(query, externalId) {
        const chatId = query.message.chat.id;
        await this.qrisHandler.checkPaymentStatus(chatId, externalId);
        await this.bot.answerCallbackQuery(query.id, { text: 'Status pembayaran telah dicek' });
    }
}

module.exports = ContentPurchase;