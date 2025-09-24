class ContentManagement {
    constructor(bot, db, userSessions) {
        this.bot = bot;
        this.db = db;
        this.userSessions = userSessions;
        this.mediaUploadSessions = new Map(); // userId -> { files: [], timeout: timeoutId }
    }

    async handleMediaUpload(msg, channel) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const mediaGroupId = msg.media_group_id;
        
        // If it's part of a media group, collect all files
        if (mediaGroupId) {
            await this.handleMediaGroup(msg, channel, mediaGroupId);
            return;
        }
        
        // Single file upload
        if (msg.video) {
            await this.handleSingleVideoUpload(msg, channel);
        } else {
            await this.bot.sendMessage(chatId, 
                '❌ Untuk upload konten, kirimkan video beserta gambar thumbnail dalam satu media group.\n\n' +
                'Format: pilih beberapa file (video + gambar) dan kirim bersamaan dengan caption format: #harga#deskripsi'
            );
        }
    }

    async handleMediaGroup(msg, channel, mediaGroupId) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        
        // Initialize or get existing session
        if (!this.mediaUploadSessions.has(userId)) {
            this.mediaUploadSessions.set(userId, {
                files: [],
                caption: '',
                channelId: channel.id,
                timeout: null
            });
        }
        
        const session = this.mediaUploadSessions.get(userId);
        
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
            await this.processMediaGroup(userId, chatId, session);
            this.mediaUploadSessions.delete(userId);
        }, 3000);
    }

    async processMediaGroup(userId, chatId, session) {
        const { files, caption, channelId } = session;
        
        // Validate media group
        const videos = files.filter(f => f.type === 'video');
        const photos = files.filter(f => f.type === 'photo');
        
        if (videos.length === 0) {
            await this.bot.sendMessage(chatId, 
                '❌ Media group harus mengandung minimal 1 video.\n\n' +
                'Format yang benar: video + gambar thumbnail + caption (#harga#deskripsi)'
            );
            return;
        }
        
        if (!caption) {
            await this.bot.sendMessage(chatId, 
                '❌ Caption tidak ditemukan.\n\n' +
                'Format caption: #harga#deskripsi\n' +
                'Contoh: #15000#Video tutorial menarik!'
            );
            return;
        }
        
        // Parse caption
        const captionMatch = caption.match(/^#(\d+)#(.+)$/);
        if (!captionMatch) {
            await this.bot.sendMessage(chatId, 
                '❌ Format caption tidak valid.\n\n' +
                'Format yang benar: #harga#deskripsi\n' +
                'Contoh: #15000#Video tutorial yang sangat menarik!'
            );
            return;
        }
        
        const price = parseInt(captionMatch[1]);
        const description = captionMatch[2].trim();
        
        if (price < 1000 || price > 1000000) {
            await this.bot.sendMessage(chatId, 
                '❌ Harga tidak valid.\n\n' +
                'Harga harus antara Rp 1.000 - Rp 1.000.000'
            );
            return;
        }
        
        // Create media content record
        try {
            const contentId = await this.db.createMediaContent({
                channel_id: channelId,
                user_id: userId,
                video_file_id: videos[0].file_id,
                image_file_id: photos.length > 0 ? photos[0].file_id : null,
                base_price_idr: price,
                caption: description,
                raw_caption: caption,
                video_duration: videos[0].duration || 0
            });
            
            await this.db.logActivity(userId, channelId, 'media_upload', 'Media content uploaded', {
                content_id: contentId,
                price: price,
                files_count: files.length
            });
            
            // Show preview and ask for confirmation
            await this.showPreviewAndConfirm(chatId, userId, contentId, {
                video: videos[0],
                image: photos[0] || null,
                price: price,
                description: description
            });
            
        } catch (error) {
            console.error('Error creating media content:', error);
            await this.bot.sendMessage(chatId, 
                '❌ Gagal menyimpan konten.\n\n' +
                'Terjadi kesalahan sistem. Silakan coba lagi.'
            );
        }
    }

    async handleSingleVideoUpload(msg, channel) {
        const chatId = msg.chat.id;
        
        await this.bot.sendMessage(chatId, 
            '📹 **Video Terdeteksi**\n\n' +
            'Untuk hasil terbaik, kirimkan video beserta gambar thumbnail dalam satu media group.\n\n' +
            '**Cara yang direkomendasikan:**\n' +
            '1. Pilih video + gambar thumbnail\n' +
            '2. Kirim bersamaan dengan caption #harga#deskripsi\n\n' +
            '**Atau lanjutkan dengan video saja:**',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Lanjutkan Tanpa Thumbnail', callback_data: `process_single_${msg.video.file_id}` }],
                        [{ text: '🔙 Upload Ulang dengan Thumbnail', callback_data: 'upload_start' }]
                    ]
                }
            }
        );
    }

    async showPreviewAndConfirm(chatId, userId, contentId, content) {
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
            ],
            [{ text: '🗑️ Batalkan', callback_data: `delete_${contentId}` }]
        ];
        
        // Send preview with thumbnail if available
        if (image) {
            await this.bot.sendPhoto(chatId, image.file_id, {
                caption: previewText,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            await this.bot.sendMessage(chatId, previewText, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }
    }

    async handleContentPosting(query, contentId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        try {
            // Get user's verified channels
            const channels = await this.db.getUserChannels(userId);
            const verifiedChannels = channels.filter(channel => 
                channel.bot_admin_status === 'verified' && 
                channel.channel_id && 
                channel.channel_id !== 'NULL'
            );
            
            if (verifiedChannels.length === 0) {
                await this.bot.editMessageText(
                    '❌ **Tidak ada channel yang terverifikasi**\n\nSilakan setup channel terlebih dahulu dengan /setup dan pastikan bot sudah menjadi admin di channel.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown'
                    }
                );
                return;
            }
            
            const channel = verifiedChannels[0];
            
            // Get content details
            const content = await this.db.getContentById(contentId);
            if (!content) {
                await this.bot.editMessageText(
                    '❌ **Konten tidak ditemukan**\n\nKonten mungkin sudah dihapus.',
                    {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown'
                    }
                );
                return;
            }
            
            // Create deep link for content purchase
            const botInfo = await this.bot.getMe();
            const deepLink = `https://t.me/${botInfo.username}?start=content_${contentId}`;
            
            // Create preview post for channel
            const channelMessage = `
🎬 **${content.caption}**

💰 **Harga:** Rp ${parseInt(content.base_price_idr).toLocaleString('id-ID')}
⏱️ **Durasi:** ${Math.floor(content.video_duration / 60)}m ${content.video_duration % 60}s

👇 Klik tombol di bawah untuk membeli konten ini
            `;
            
            // Post to channel with purchase button
            let channelPostId = null;
            if (content.image_file_id) {
                const result = await this.bot.sendPhoto(channel.channel_id, content.image_file_id, {
                    caption: channelMessage,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🛒 Beli Konten Ini', url: deepLink }]
                        ]
                    }
                });
                channelPostId = result.message_id;
            } else {
                const result = await this.bot.sendMessage(channel.channel_id, channelMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🛒 Beli Konten Ini', url: deepLink }]
                        ]
                    }
                });
                channelPostId = result.message_id;
            }
            
            // Update content status in database
            await this.db.updateMediaContent(contentId, {
                post_status: 'published',
                channel_message_id: channelPostId,
                published_at: new Date()
            });
            
            const successMessage = '✅ **Konten berhasil diposting!**\n\nKonten Anda telah dipublikasikan di channel dan siap untuk dijual.';
            
            if (query.message.photo) {
                await this.bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
            } else {
                await this.bot.editMessageText(successMessage, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📤 Upload Konten Lain', callback_data: 'upload_start' }],
                            [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
                        ]
                    }
                });
            }
            
            await this.db.logActivity(userId, channel.id, 'content_published', 'Content successfully posted to channel', {
                content_id: contentId,
                channel_post_id: channelPostId
            });
            
        } catch (error) {
            console.error('Error posting content:', error);
            const errorMessage = '❌ Gagal memposting konten.\n\nTerjadi kesalahan sistem. Silakan coba lagi.';
            
            if (query.message.photo) {
                await this.bot.sendMessage(chatId, errorMessage);
            } else {
                await this.bot.editMessageText(errorMessage, {
                    chat_id: chatId,
                    message_id: query.message.message_id
                });
            }
        }
    }

    async handleContentEdit(query, contentId) {
        const chatId = query.message.chat.id;
        
        // If the message has a photo, we need to send a new message instead of editing
        if (query.message.photo) {
            await this.bot.sendMessage(chatId, 
                '✏️ **Edit Konten**\n\nFitur edit konten akan segera tersedia.\n\nUntuk saat ini, silakan upload ulang konten dengan detail yang benar.',
                { parse_mode: 'Markdown' }
            );
        } else {
            await this.bot.editMessageText(
                '✏️ **Edit Konten**\n\nFitur edit konten akan segera tersedia.\n\nUntuk saat ini, silakan upload ulang konten dengan detail yang benar.',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown'
                }
            );
        }
    }

    async handleContentDelete(query, contentId) {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        
        await this.bot.editMessageText(
            '🗑️ **Konten Dibatalkan**\n\nKonten telah dibatalkan dan tidak akan diposting ke channel.',
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📤 Upload Konten Lain', callback_data: 'upload_start' }],
                        [{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
        
        // Log the cancellation
        await this.db.logActivity(userId, null, 'content_cancelled', 'User cancelled content posting', {
            content_id: contentId
        });
    }

    async startUploadProcess(chatId, userId) {
        const channels = await this.db.getUserChannels(userId);
        
        if (channels.length === 0) {
            await this.bot.sendMessage(chatId, 
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
        
        await this.bot.sendMessage(chatId, uploadText, {
            parse_mode: 'Markdown'
        });
    }
}

module.exports = ContentManagement;