const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs').promises;
const https = require('https');

// Bot configuration - Railway will use environment variables
const config = {
    token: process.env.DISCORD_TOKEN,
    guildId: process.env.GUILD_ID,
    attendanceChannelId: process.env.ATTENDANCE_CHANNEL_ID,
    gitChannelId: process.env.GIT_CHANNEL_ID,
    webhookSecret: process.env.WEBHOOK_SECRET || 'default_secret',
    port: process.env.PORT || 3000
};

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Create Express app for webhooks
const app = express();
app.use(express.json());

// Attendance data storage
let attendanceData = {};

// Translation function using MyMemory API (FREE, no registration)
async function translateText(text, targetLang = 'en', sourceLang = 'ja') {
    return new Promise((resolve, reject) => {
        try {
            console.log(`🔄 Translating with MyMemory API (${sourceLang} -> ${targetLang})...`);
            
            // Encode the text for URL
            const encodedText = encodeURIComponent(text);
            const langPair = `${sourceLang}|${targetLang}`;
            const path = `/get?q=${encodedText}&langpair=${langPair}`;
            
            const options = {
                hostname: 'api.mymemory.translated.net',
                port: 443,
                path: path,
                method: 'GET',
                headers: {
                    'User-Agent': 'Discord-Bot/1.0'
                },
                timeout: 15000
            };
            
            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        
                        if (result.responseData && result.responseData.translatedText) {
                            const translatedText = result.responseData.translatedText;
                            console.log(`✅ MyMemory translation successful (${sourceLang} -> ${targetLang})`);
                            resolve(translatedText);
                        } else {
                            console.error('❌ No translation returned:', result);
                            resolve(null);
                        }
                    } catch (parseError) {
                        console.error('❌ JSON parse error:', parseError);
                        resolve(null);
                    }
                });
            });
            
            req.on('error', (error) => {
                console.error('❌ MyMemory request error:', error.message);
                resolve(null);
            });
            
            req.on('timeout', () => {
                console.error('❌ MyMemory request timeout');
                req.destroy();
                resolve(null);
            });
            
            req.end();
            
        } catch (error) {
            console.error('❌ MyMemory error:', error.message);
            resolve(null);
        }
    });
}

// Detect if text contains Japanese characters
function containsJapanese(text) {
    // Japanese character ranges: Hiragana, Katakana, Kanji
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
    return japaneseRegex.test(text);
}

// NEW: Detect if text contains primarily English characters (and no Japanese)
function containsEnglish(text) {
    // Check if text contains English letters and doesn't contain Japanese
    const englishRegex = /[a-zA-Z]/;
    const hasEnglish = englishRegex.test(text);
    const hasJapanese = containsJapanese(text);
    
    // Return true only if it has English characters but no Japanese characters
    // and the text is substantial enough (more than just numbers/symbols)
    return hasEnglish && !hasJapanese && text.replace(/[^a-zA-Z]/g, '').length >= 3;
}

// NEW: Determine translation direction based on text content
function getTranslationDirection(text) {
    if (containsJapanese(text)) {
        return {
            sourceLang: 'ja',
            targetLang: 'en',
            direction: 'jp-to-en'
        };
    } else if (containsEnglish(text)) {
        return {
            sourceLang: 'en',
            targetLang: 'ja',
            direction: 'en-to-jp'
        };
    }
    return null;
}

// Check if channel should have translation (exclude certain channels)
function shouldTranslate(channelId) {
    // Don't translate in these channels
    const excludedChannels = [
        config.attendanceChannelId,  // Don't translate attendance commands
        config.gitChannelId          // Don't translate git notifications
    ];
    
    return !excludedChannels.includes(channelId);
}

// NEW: Function to check for attendance commands in message content
function checkForAttendanceCommand(content) {
    const attendanceCommands = {
        '出勤': 'start',      // Start work
        '休憩': 'break',      // Take break  
        '再開': 'return',     // Return from break
        '退勤': 'off'         // End work
    };
    
    // Check if any attendance command is present in the message
    for (const [keyword, command] of Object.entries(attendanceCommands)) {
        if (content.includes(keyword)) {
            // Extract the additional text (everything except the attendance keyword)
            const additionalText = content.replace(keyword, '').trim();
            
            return {
                command: command,
                keyword: keyword,
                additionalText: additionalText
            };
        }
    }
    
    return null;
}

// Load attendance data from file
async function loadAttendanceData() {
    try {
        const data = await fs.readFile('attendance.json', 'utf8');
        attendanceData = JSON.parse(data);
        console.log('✅ 出勤データを読み込みました (Attendance data loaded)');
    } catch (error) {
        console.log('📝 新しい出勤データを開始します (Starting new attendance data)');
        attendanceData = {};
    }
}

// Save attendance data to file
async function saveAttendanceData() {
    try {
        await fs.writeFile('attendance.json', JSON.stringify(attendanceData, null, 2));
        console.log('💾 出勤データを保存しました (Attendance data saved)');
    } catch (error) {
        console.error('❌ Error saving attendance data:', error);
    }
}

// When bot comes online
client.once('ready', async () => {
    console.log(`🤖 Bot logged in as ${client.user.tag}!`);
    console.log('🎌 日本の出勤システムが準備完了！(Japanese attendance system ready!)');
    console.log('🔧 Git通知システムが準備完了！(Git notification system ready!)');
    console.log('🌐 双方向自動翻訳システムが準備完了！(Bidirectional auto-translation system ready!)');
    console.log('   - 日本語 → 英語 (Japanese → English)');
    console.log('   - 英語 → 日本語 (English → Japanese)');
    console.log(`🌐 Webhook server running on port ${config.port}`);
    
    // Load attendance data
    await loadAttendanceData();
    
    // Show configuration status
    console.log('⚙️ Configuration Status:');
    console.log(`   Discord Token: ${config.token ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Guild ID: ${config.guildId ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Attendance Channel: ${config.attendanceChannelId ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Git Channel: ${config.gitChannelId ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Translation API: ✅ MyMemory (No key required)`);
});

// =============================================================================
// ATTENDANCE SYSTEM (Japanese Commands) - UPDATED
// =============================================================================

// Listen for messages (attendance commands and translation) - UPDATED WITH BIDIRECTIONAL TRANSLATION
client.on('messageCreate', async message => {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Handle attendance status commands first
    if (message.content === '状況' || message.content === '確認') {
        await handleStatusCheck(message);
        return;
    }
    
    // Check for attendance commands within the message content
    const attendanceInfo = checkForAttendanceCommand(message.content);
    
    if (attendanceInfo) {
        const user = message.author;
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        
        try {
            // Store any additional text as a report
            const report = attendanceInfo.additionalText.trim();
            
            switch (attendanceInfo.command) {
                case 'start':
                    await handleStart(message, user, today, now, report);
                    break;
                case 'break':
                    await handleBreak(message, user, today, now, report);
                    break;
                case 'return':
                    await handleReturn(message, user, today, now, report);
                    break;
                case 'off':
                    await handleOff(message, user, today, now, report);
                    break;
            }
        } catch (error) {
            console.error('❌ Error handling attendance:', error);
            await message.reply('エラーが発生しました。もう一度お試しください。(An error occurred. Please try again.)');
        }
        return;
    }
    
    // UPDATED: Handle bidirectional translation for work channels
    if (shouldTranslate(message.channel.id)) {
        const translationDirection = getTranslationDirection(message.content);
        
        if (translationDirection) {
            try {
                await handleTranslation(message, translationDirection);
            } catch (error) {
                console.error('❌ Error handling translation:', error);
            }
        }
    }
});

// UPDATED: Handle automatic bidirectional translation
async function handleTranslation(message, translationDirection) {
    // Skip very short messages or attendance commands
    if (message.content.length < 3 || checkForAttendanceCommand(message.content)) {
        return;
    }
    
    const { sourceLang, targetLang, direction } = translationDirection;
    const directionText = direction === 'jp-to-en' ? 'Japanese → English' : 'English → Japanese';
    
    console.log(`🌐 Translating message (${directionText}) from ${message.author.username} in #${message.channel.name}`);
    
    try {
        const translatedText = await translateText(message.content, targetLang, sourceLang);
        
        if (translatedText && translatedText !== message.content) {
            // Create a simple embed to show the translation direction
            let flagEmoji = direction === 'jp-to-en' ? '🇯🇵➡️🇺🇸' : '🇺🇸➡️🇯🇵';
            
            // Reply directly to the message with the translation
            await message.reply(`${flagEmoji} ${translatedText}`);
            
            console.log(`✅ Translation sent (${directionText}) for message from ${message.author.username}`);
        } else {
            console.log(`⚠️ MyMemory translation failed or returned same text (${directionText})`);
        }
    } catch (error) {
        console.error(`❌ Translation failed (${directionText}):`, error);
    }
}

// Handle 出勤 (Start work) - UPDATED with report parameter
async function handleStart(message, user, today, now, report = '') {
    const userId = user.id;
    
    if (!attendanceData[userId]) {
        attendanceData[userId] = {};
    }
    
    if (attendanceData[userId][today] && attendanceData[userId][today].start) {
        await message.reply('❌ 今日はもう出勤済みです！(You have already checked in today!)');
        return;
    }
    
    attendanceData[userId][today] = {
        username: user.username,
        start: now.toISOString(),
        status: 'working',
        breaks: [],
        reports: {
            checkIn: report || null
        }
    };
    
    await saveAttendanceData();
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🟢 出勤 (Check In)')
        .setDescription(`${user.username}さんが出勤しました`)
        .addFields(
            { name: '時間 (Time)', value: now.toLocaleTimeString('ja-JP'), inline: true },
            { name: '日付 (Date)', value: today, inline: true }
        )
        .setTimestamp();
    
    // Add report field if there's additional text
    if (report) {
        embed.addFields({ name: '報告 (Report)', value: report, inline: false });
    }
    
    await message.reply({ embeds: [embed] });
    await message.channel.send('**📊 スプレッドシートに記録しました**');
    
    // Send to attendance channel if different
    const attendanceChannel = client.channels.cache.get(config.attendanceChannelId);
    if (attendanceChannel && attendanceChannel.id !== message.channel.id) {
        await attendanceChannel.send({ embeds: [embed] });
    }
    
    console.log(`✅ ${user.username} checked in at ${now.toLocaleTimeString()}${report ? ' with report' : ''}`);
}

// Handle 休憩 (Break) - UPDATED with report parameter
async function handleBreak(message, user, today, now, report = '') {
    const userId = user.id;
    
    if (!attendanceData[userId] || !attendanceData[userId][today] || !attendanceData[userId][today].start) {
        await message.reply('❌ まず出勤してください！(Please check in first!)');
        return;
    }
    
    if (attendanceData[userId][today].status === 'break') {
        await message.reply('❌ すでに休憩中です！(You are already on break!)');
        return;
    }
    
    if (attendanceData[userId][today].status === 'finished') {
        await message.reply('❌ 既に退勤済みです！(You have already checked out!)');
        return;
    }
    
    attendanceData[userId][today].breaks.push({
        start: now.toISOString(),
        report: report || null
    });
    attendanceData[userId][today].status = 'break';
    
    await saveAttendanceData();
    
    const embed = new EmbedBuilder()
        .setColor('#ffff00')
        .setTitle('🟡 休憩開始 (Break Start)')
        .setDescription(`${user.username}さんが休憩に入りました`)
        .addFields(
            { name: '時間 (Time)', value: now.toLocaleTimeString('ja-JP'), inline: true }
        )
        .setTimestamp();
    
    // Add report field if there's additional text
    if (report) {
        embed.addFields({ name: '進捗報告 (Progress Report)', value: report, inline: false });
    }
    
    await message.reply({ embeds: [embed] });
    await message.channel.send('**📊 スプレッドシートに記録しました**');
    
    console.log(`🟡 ${user.username} started break at ${now.toLocaleTimeString()}${report ? ' with progress report' : ''}`);
}

// Handle 再開 (Return from break) - UPDATED with report parameter
async function handleReturn(message, user, today, now, report = '') {
    const userId = user.id;
    
    if (!attendanceData[userId] || !attendanceData[userId][today] || attendanceData[userId][today].status !== 'break') {
        await message.reply('❌ 休憩中ではありません！(You are not on break!)');
        return;
    }
    
    const currentBreak = attendanceData[userId][today].breaks[attendanceData[userId][today].breaks.length - 1];
    if (currentBreak && !currentBreak.end) {
        currentBreak.end = now.toISOString();
        const breakStart = new Date(currentBreak.start);
        const breakDuration = (now - breakStart) / (1000 * 60);
        currentBreak.duration = Math.round(breakDuration);
        
        // Add return report if provided
        if (report) {
            currentBreak.returnReport = report;
        }
    }
    
    attendanceData[userId][today].status = 'working';
    await saveAttendanceData();
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🟢 休憩終了 (Break End)')
        .setDescription(`${user.username}さんが仕事に戻りました`)
        .addFields(
            { name: '時間 (Time)', value: now.toLocaleTimeString('ja-JP'), inline: true },
            { name: '休憩時間 (Break Duration)', value: `${currentBreak.duration || 0}分`, inline: true }
        )
        .setTimestamp();
    
    // Add report field if there's additional text
    if (report) {
        embed.addFields({ name: '復帰報告 (Return Report)', value: report, inline: false });
    }
    
    await message.reply({ embeds: [embed] });
    await message.channel.send('**📊 スプレッドシートに記録しました**');
    
    console.log(`🟢 ${user.username} returned from break (${currentBreak.duration || 0} minutes)${report ? ' with return report' : ''}`);
}

// Handle 退勤 (End work) - UPDATED with report parameter
async function handleOff(message, user, today, now, report = '') {
    const userId = user.id;
    
    if (!attendanceData[userId] || !attendanceData[userId][today] || !attendanceData[userId][today].start) {
        await message.reply('❌ まず出勤してください！(Please check in first!)');
        return;
    }
    
    if (attendanceData[userId][today].status === 'finished') {
        await message.reply('❌ 今日はもう退勤済みです！(You have already checked out today!)');
        return;
    }
    
    // If currently on break, end the break first
    if (attendanceData[userId][today].status === 'break') {
        const currentBreak = attendanceData[userId][today].breaks[attendanceData[userId][today].breaks.length - 1];
        if (currentBreak && !currentBreak.end) {
            currentBreak.end = now.toISOString();
            const breakStart = new Date(currentBreak.start);
            const breakDuration = (now - breakStart) / (1000 * 60);
            currentBreak.duration = Math.round(breakDuration);
        }
    }
    
    attendanceData[userId][today].end = now.toISOString();
    attendanceData[userId][today].status = 'finished';
    
    // Store the end-of-day report
    if (report) {
        if (!attendanceData[userId][today].reports) {
            attendanceData[userId][today].reports = {};
        }
        attendanceData[userId][today].reports.checkOut = report;
    }
    
    // Calculate total work time
    const startTime = new Date(attendanceData[userId][today].start);
    const totalTime = (now - startTime) / (1000 * 60 * 60);
    
    // Calculate total break time
    let totalBreakTime = 0;
    attendanceData[userId][today].breaks.forEach(breakPeriod => {
        if (breakPeriod.duration) {
            totalBreakTime += breakPeriod.duration;
        }
    });
    
    const workTime = totalTime - (totalBreakTime / 60);
    attendanceData[userId][today].totalHours = workTime.toFixed(2);
    attendanceData[userId][today].totalBreakMinutes = totalBreakTime;
    
    await saveAttendanceData();
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('🔴 退勤 (Check Out)')
        .setDescription(`${user.username}さんがお疲れ様でした`)
        .addFields(
            { name: '退勤時間 (Check Out)', value: now.toLocaleTimeString('ja-JP'), inline: true },
            { name: '総労働時間 (Total Work)', value: `${workTime.toFixed(2)}時間`, inline: true },
            { name: '休憩時間 (Break Time)', value: `${totalBreakTime}分`, inline: true },
            { name: '出勤時間 (Check In)', value: startTime.toLocaleTimeString('ja-JP'), inline: true }
        )
        .setTimestamp();
    
    // Add daily report field if there's additional text
    if (report) {
        embed.addFields({ name: '本日の業務報告 (Daily Work Report)', value: report, inline: false });
    }
    
    await message.reply({ embeds: [embed] });
    await message.channel.send('**📊 スプレッドシートに記録しました**');
    
    console.log(`🔴 ${user.username} checked out - Total: ${workTime.toFixed(2)}h, Break: ${totalBreakTime}min${report ? ' with daily report' : ''}`);
}

// Handle status check
async function handleStatusCheck(message) {
    const user = message.author;
    const userId = user.id;
    const today = new Date().toISOString().split('T')[0];
    
    if (!attendanceData[userId] || !attendanceData[userId][today]) {
        await message.reply('📝 今日はまだ出勤していません。(You have not checked in today yet.)');
        return;
    }
    
    const todayData = attendanceData[userId][today];
    let statusText = '';
    
    switch (todayData.status) {
        case 'working':
            statusText = '🟢 勤務中 (Working)';
            break;
        case 'break':
            statusText = '🟡 休憩中 (On Break)';
            break;
        case 'finished':
            statusText = '🔴 退勤済み (Checked Out)';
            break;
        default:
            statusText = '❓ 不明 (Unknown)';
    }
    
    const startTime = todayData.start ? new Date(todayData.start).toLocaleTimeString('ja-JP') : '未記録';
    const endTime = todayData.end ? new Date(todayData.end).toLocaleTimeString('ja-JP') : '未記録';
    
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`📊 ${user.username}さんの今日の状況 (Today's Status)`)
        .addFields(
            { name: '現在の状態 (Current Status)', value: statusText, inline: true },
            { name: '出勤時間 (Check In)', value: startTime, inline: true },
            { name: '退勤時間 (Check Out)', value: endTime, inline: true },
            { name: '休憩回数 (Break Count)', value: `${todayData.breaks ? todayData.breaks.length : 0}回`, inline: true }
        )
        .setTimestamp();
    
    if (todayData.totalHours) {
        embed.addFields({ name: '総労働時間 (Total Hours)', value: `${todayData.totalHours}時間`, inline: true });
    }
    
    await message.reply({ embeds: [embed] });
}

// =============================================================================
// BITBUCKET WEBHOOK SYSTEM
// =============================================================================

// GitHub webhook endpoint
app.post('/webhook/github', async (req, res) => {
    try {
        console.log('📡 Received GitHub webhook');
        
        const payload = req.body;
        const eventType = req.headers['x-github-event'];
        
        console.log(`📋 Event Type: ${eventType}`);
        
        // DEBUG: Log the entire payload structure
        console.log('🔍 DEBUG - Full payload structure:');
        console.log('Payload keys:', Object.keys(payload || {}));
        console.log('Payload type:', typeof payload);
        console.log('Payload content (first 500 chars):', JSON.stringify(payload).substring(0, 500));
        
        // DEBUG: Check specific fields
        if (payload) {
            console.log('Has repository?', !!payload.repository);
            console.log('Has ref?', !!payload.ref);
            console.log('Has commits?', !!payload.commits);
            console.log('Has pusher?', !!payload.pusher);
            console.log('Has sender?', !!payload.sender);
        }
        
        // Only handle push events
        if (eventType === 'push') {
            await handleGitHubPush(payload);
        } else {
            console.log(`⏭️ Ignoring event type: ${eventType}`);
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ GitHub webhook error:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Bitbucket webhook endpoint
app.post('/webhook/bitbucket', async (req, res) => {
    try {
        console.log('📡 Received Bitbucket webhook');
        
        const payload = req.body;
        const eventType = req.headers['x-event-key'];
        
        console.log(`📋 Event Type: ${eventType}`);
        
        // Only handle push events
        if (eventType === 'repo:push') {
            await handleBitbucketPush(payload);
        } else {
            console.log(`⏭️ Ignoring event type: ${eventType}`);
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Bitbucket webhook error:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Handle GitHub push notifications
async function handleGitHubPush(payload) {
    try {
        // Add safety checks for undefined values
        if (!payload || !payload.repository) {
            console.log('❌ Invalid GitHub payload - missing repository data');
            return;
        }

        const repository = payload.repository;
        const pusher = payload.pusher || payload.sender || { name: 'Unknown', avatar_url: '' };
        const commits = payload.commits || [];
        
        // Safe branch name extraction
        let branchName = 'unknown';
        if (payload.ref && typeof payload.ref === 'string') {
            branchName = payload.ref.replace('refs/heads/', '');
        } else if (payload.head_commit && payload.head_commit.id) {
            branchName = 'main'; // fallback
        }
        
        console.log(`🔄 Processing GitHub push to ${repository.name} by ${pusher.name}`);
        
        if (commits.length === 0) {
            console.log('No commits in push, skipping notification');
            return;
        }
        
        console.log(`📦 ${commits.length} commits to ${branchName} branch`);
        
        // Create embed for the push notification
        const embed = new EmbedBuilder()
            .setColor('#24292e') // GitHub dark color
            .setTitle('📦 GitHub Push Notification')
            .setDescription(`**Repository:** ${repository.name}\n**Branch:** ${branchName}\n**Pushed by:** ${pusher.name || 'Unknown'}`)
            .addFields(
                { name: 'Commits', value: `${commits.length} commit(s)`, inline: true },
                { name: 'Repository', value: `[${repository.full_name}](${repository.html_url})`, inline: true }
            )
            .setThumbnail(pusher.avatar_url || repository.owner?.avatar_url || '')
            .setTimestamp();
        
        // Add commit details (max 5 commits)
        let commitDetails = '';
        const commitsToShow = commits.slice(0, 5);
        
        for (const commit of commitsToShow) {
            const shortHash = commit.id ? commit.id.substring(0, 7) : 'unknown';
            const message = commit.message ? commit.message.split('\n')[0] : 'No message'; // First line only
            
            // Create GitHub commit URL safely
            let commitUrl = '#';
            if (commit.url) {
                commitUrl = commit.url.replace('api.github.com/repos', 'github.com').replace('/commits/', '/commit/');
            } else if (repository.html_url && commit.id) {
                commitUrl = `${repository.html_url}/commit/${commit.id}`;
            }
            
            commitDetails += `• [\`${shortHash}\`](${commitUrl}) ${message}\n`;
        }
        
        if (commitDetails) {
            embed.addFields({ 
                name: commits.length > 5 ? `Recent Commits (showing ${commitsToShow.length} of ${commits.length})` : 'Commits',
                value: commitDetails, 
                inline: false 
            });
        }
        
        // Send to git notifications channel
        const gitChannel = client.channels.cache.get(config.gitChannelId);
        if (gitChannel) {
            await gitChannel.send({ embeds: [embed] });
            console.log(`✅ GitHub notification sent for ${repository.name}/${branchName}`);
        } else {
            console.error('❌ Git notification channel not found');
        }
    } catch (error) {
        console.error('❌ Error handling GitHub push:', error);
    }
}

// Handle Bitbucket push notifications
async function handleBitbucketPush(payload) {
    try {
        const repository = payload.repository;
        const pusher = payload.actor;
        const changes = payload.push.changes;
        
        console.log(`🔄 Processing push to ${repository.name} by ${pusher.display_name}`);
        
        // Process each branch that was pushed
        for (const change of changes) {
            if (!change.new || change.new.type !== 'branch') continue;
            
            const branchName = change.new.name;
            const commits = change.commits || [];
            
            if (commits.length === 0) continue;
            
            console.log(`📦 ${commits.length} commits to ${branchName} branch`);
            
            // Create embed for the push notification
            const embed = new EmbedBuilder()
                .setColor('#0052CC') // Bitbucket blue
                .setTitle('🔧 Bitbucket Push Notification')
                .setDescription(`**Repository:** ${repository.name}\n**Branch:** ${branchName}\n**Pushed by:** ${pusher.display_name}`)
                .addFields(
                    { name: 'Commits', value: `${commits.length} commit(s)`, inline: true },
                    { name: 'Repository', value: `[${repository.full_name}](${repository.links.html.href})`, inline: true }
                )
                .setThumbnail(pusher.links?.avatar?.href || '')
                .setTimestamp();
            
            // Add commit details (max 5 commits)
            let commitDetails = '';
            const commitsToShow = commits.slice(0, 5);
            
            for (const commit of commitsToShow) {
                const shortHash = commit.hash.substring(0, 7);
                const message = commit.message.split('\n')[0]; // First line only
                const commitUrl = commit.links?.html?.href;
                
                if (commitUrl) {
                    commitDetails += `• [\`${shortHash}\`](${commitUrl}) ${message}\n`;
                } else {
                    commitDetails += `• \`${shortHash}\` ${message}\n`;
                }
            }
            
            if (commitDetails) {
                embed.addFields({ 
                    name: commits.length > 5 ? `Recent Commits (showing ${commitsToShow.length} of ${commits.length})` : 'Commits',
                    value: commitDetails, 
                    inline: false 
                });
            }
            
            // Send to git notifications channel
            const gitChannel = client.channels.cache.get(config.gitChannelId);
            if (gitChannel) {
                await gitChannel.send({ embeds: [embed] });
                console.log(`✅ Git notification sent for ${repository.name}/${branchName}`);
            } else {
                console.error('❌ Git notification channel not found');
            }
        }
    } catch (error) {
        console.error('❌ Error handling Bitbucket push:', error);
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('Bot is running! 🤖');
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).send(`
        <h1>Discord Company Bot 🤖</h1>
        <p>✅ Bot is running successfully!</p>
        <p>📊 Attendance System: Active (with Report Support)</p>
        <p>🔧 Git Notifications: Active</p>
        <p>🌐 Bidirectional Auto-Translation: Active (MyMemory API)</p>
        <p>   - 🇯🇵➡️🇺🇸 Japanese → English</p>
        <p>   - 🇺🇸➡️🇯🇵 English → Japanese</p>
        <p>📡 GitHub webhook endpoint: /webhook/github</p>
        <p>📡 Bitbucket webhook endpoint: /webhook/bitbucket</p>
    `);
});

// Start the Express server
app.listen(config.port, () => {
    console.log(`🌐 Webhook server running on port ${config.port}`);
    console.log(`📡 GitHub webhook URL: http://localhost:${config.port}/webhook/github`);
    console.log(`📡 Bitbucket webhook URL: http://localhost:${config.port}/webhook/bitbucket`);
    console.log(`🌐 Bidirectional Translation: MyMemory API (Free, no registration required)`);
});

// Start the Discord bot
client.login(config.token);