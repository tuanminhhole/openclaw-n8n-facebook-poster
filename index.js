import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const openclawHome = path.resolve(__dirname, '..', '..');

const plugin = definePluginEntry({
  id: 'openclaw-n8n-facebook-poster',
  name: 'N8n Facebook Poster',
  description: 'Gom bài viết và hình ảnh từ Zalo để đăng lên Facebook qua hệ thống n8n.',

  register(api) {
    const drafts = new Map();
    const configPath = path.join(__dirname, 'config.json');

    let config = { webhookUrl: '', webhooks: {}, adminIds: [] };
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!config.webhooks) config.webhooks = {};
      }
    } catch(e) {}

    function saveConfig() {
      try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } catch(e) {}
    }

    /**
     * Tạo thư mục lưu content theo ngày: content/YYYY-MM-DD/
     * Trong thư mục plugin, để dễ mount/backup.
     */
    function getContentDir() {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const dir = path.join(__dirname, 'content', today);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      return dir;
    }

    /**
     * Download ảnh từ URL về local content dir.
     * Trả về đường dẫn file đã lưu.
     */
    async function downloadImage(url, destDir) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Luna-Bot/1.0)',
            'Referer': 'https://zalo.me/'
          }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // Xác định extension từ Content-Type hoặc URL
        const contentType = res.headers.get('content-type') || '';
        let ext = '.jpg';
        if (contentType.includes('png')) ext = '.png';
        else if (contentType.includes('gif')) ext = '.gif';
        else if (contentType.includes('webp')) ext = '.webp';
        else if (contentType.includes('mp4')) ext = '.mp4';
        else if (url.includes('.mp4')) ext = '.mp4';

        const prefix = ext === '.mp4' ? 'vid' : 'img';
        const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
        const dest = path.join(destDir, filename);

        const arrayBuffer = await res.arrayBuffer();
        fs.writeFileSync(dest, Buffer.from(arrayBuffer));
        return { path: dest, filename, ext };
      } catch (err) {
        console.error('[n8n-poster] Download image failed:', url, err.message);
        return null;
      }
    }

    /**
     * Upload ảnh lên Telegraph (telegra.ph) để lấy public URL.
     * Telegraph miễn phí, không cần auth, FB server download được.
     */
    async function uploadToTelegraph(filePath, ext) {
      try {
        const fileBuffer = fs.readFileSync(filePath);
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4' };
        const mime = mimeMap[ext] || 'image/jpeg';

        // Tạo FormData thủ công (multipart/form-data)
        const boundary = `----FormBoundary${Date.now()}`;
        const filename = path.basename(filePath);

        const bodyParts = [
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
          fileBuffer,
          `\r\n--${boundary}--\r\n`
        ];

        // Ghép buffer
        const totalLength = bodyParts.reduce((sum, p) => sum + (Buffer.isBuffer(p) ? p.length : Buffer.byteLength(p)), 0);
        const body = Buffer.concat(bodyParts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));

        const res = await fetch('https://telegra.ph/upload', {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(totalLength)
          },
          body
        });

        if (!res.ok) throw new Error(`Telegraph HTTP ${res.status}`);
        const data = await res.json();

        // Telegraph trả về [{ src: '/file/...' }]
        if (Array.isArray(data) && data[0] && data[0].src) {
          return `https://telegra.ph${data[0].src}`;
        }
        throw new Error('Telegraph bad response: ' + JSON.stringify(data));
      } catch (err) {
        console.error('[n8n-poster] Telegraph upload failed:', err.message);
        return null;
      }
    }

    /**
     * Lưu bản thảo vào file JSON trong content dir.
     */
    function saveDraftRecord(contentDir, draft, publicUrls) {
      try {
        const record = {
          savedAt: new Date().toISOString(),
          channels: draft.channels,
          content: draft.contentParts.join('\n\n'),
          originalUrls: draft.files,
          publicUrls: publicUrls,
          localFiles: draft.localFiles || []
        };
        const recordPath = path.join(contentDir, `draft_${Date.now()}.json`);
        fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
      } catch(e) {}
    }

    async function sendMsg(ctx, conversationId, isGroup, text) {
      try {
        const paths = [
          pathToFileURL(path.join(openclawHome, 'npm/node_modules/@openclaw/zalouser/dist/test-api.js')).href,
          'file:///usr/local/lib/node_modules/openclaw/dist/extensions/zalouser/test-api.js',
          'openclaw/dist/extensions/zalouser/test-api.js'
        ];

        let sendMessageZalouser;
        for (const p of paths) {
          try {
            const module = await import(p);
            if (module && module.sendMessageZalouser) {
              sendMessageZalouser = module.sendMessageZalouser;
              break;
            }
          } catch(e) {}
        }

        if (sendMessageZalouser) {
          const targetId = String(conversationId).replace(/^group:/, '');
          await sendMessageZalouser(targetId, String(text), {
            isGroup: isGroup,
            profile: ctx?.accountId || 'default',
            textMode: 'markdown'
          });
          console.log(`[n8n-poster] sent reply to ${isGroup ? 'group' : 'dm'} ${targetId}`);
        } else {
          console.error('[n8n-poster] sendMessageZalouser API not found');
        }
      } catch (err) {
        console.error('[n8n-poster] Send message error:', err);
      }
    }

    function parseScheduleTime(timeStr) {
      const regex = /^(\d{1,2}):(\d{1,2})(?:\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?)?$/;
      const match = timeStr.trim().match(regex);
      if (!match) return null;

      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const day = match[3] ? parseInt(match[3], 10) : null;
      const month = match[4] ? parseInt(match[4], 10) : null;
      const year = match[5] ? parseInt(match[5], 10) : new Date().getFullYear();

      const target = new Date();
      if (day && month) {
        target.setFullYear(year, month - 1, day);
        target.setHours(hours, minutes, 0, 0);
      } else {
        target.setHours(hours, minutes, 0, 0);
        if (target.getTime() <= Date.now()) {
          target.setDate(target.getDate() + 1);
        }
      }
      return target;
    }

    async function executePostSend(draft, webhookTarget, rawConvId, isGroupMsg, ctx) {
      let schedulePrefix = draft.scheduleTime ? `[⏰ Hẹn giờ tới] ` : '';
      await sendMsg(ctx, rawConvId, isGroupMsg, `${schedulePrefix}⏳ Đang xử lý phương tiện (download + upload media lên CDN)...`);

      const contentDir = getContentDir();
      const publicUrls = [];

      for (const originalUrl of draft.files) {
        const downloaded = await downloadImage(originalUrl, contentDir);
        if (downloaded) {
          draft.localFiles.push(downloaded.path);
          const publicUrl = await uploadToTelegraph(downloaded.path, downloaded.ext);
          if (publicUrl) {
            publicUrls.push(publicUrl);
          } else {
            publicUrls.push(originalUrl);
          }
        } else {
          publicUrls.push(originalUrl);
        }
      }

      saveDraftRecord(contentDir, draft, publicUrls);

      const webhookUrlTarget = webhookTarget || 'http://host.docker.internal:5678/webhook/luna-post-fb';

      try {
        const payload = {
          content: draft.contentParts.join('\n\n'),
          channels: draft.channels,
          type: draft.postType || 'Text with Media',
          owner: ctx?.botName || ctx?.accountId || 'Bot',
          files: publicUrls.join(',')
        };

        const res = await fetch(webhookUrlTarget, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const respText = await res.text();

        if (res.ok) {
          let scheduleMsg = draft.scheduleTime ? `\n⏰ Hẹn giờ: ${draft.scheduleTime}` : '\n⚡ Đăng ngay';
          await sendMsg(ctx, rawConvId, isGroupMsg,
            `✅ Đã gửi bài viết sang n8n thành công.${scheduleMsg}\n` +
            `📺 Kênh: ${draft.channels}\n` +
            `📝 Nội dung: ${draft.contentParts.length} đoạn\n` +
            `🖼️ Media: ${publicUrls.length} file\n` +
            `💾 Đã lưu local: content/${new Date().toISOString().slice(0, 10)}/`
          );
          drafts.delete(rawConvId);
        } else {
          await sendMsg(ctx, rawConvId, isGroupMsg, `❌ Lỗi từ n8n (HTTP ${res.status}):\n${respText}`);
          draft.state = 'DRAFTING';
        }
      } catch (err) {
        await sendMsg(ctx, rawConvId, isGroupMsg, `❌ Lỗi kết nối: ${err.message}\nHãy kiểm tra lại n8n hoặc Webhook URL.`);
        draft.state = 'DRAFTING';
      }
    }

    api.on('before_dispatch', async (event, ctx) => {
      if (ctx?.channelId !== 'zalouser') return;

      const content = String(event?.body || event?.content || '').trim();
      const rawConvId = String(ctx.conversationId || event.conversationId || '');
      const isGroupMsg = rawConvId.startsWith('group:');
      const senderId = String(ctx.senderId || event.senderId || '');

      const isCommand = content.startsWith('/');
      if (isCommand) console.log(`[n8n-poster] command="${content}" sender=${senderId} conv=${rawConvId}`);

      // Auto-claim admin for the first command user if admin list is empty
      if (isCommand && config.adminIds.length === 0 && senderId) {
        config.adminIds.push(senderId);
        saveConfig();
        await sendMsg(ctx, rawConvId, isGroupMsg, `👋 Chào bạn, bạn đã trở thành Admin của plugin openclaw-n8n-facebook-poster.\n\n⚠️ Bạn cần thiết lập N8N Webhook URL để bắt đầu.\nHãy gửi lệnh: /set-webhook <URL_CUA_BAN>`);
        return { handled: true };
      }

      const isAdmin = config.adminIds.includes(senderId) || (api.config && api.config.ownerId === senderId);

      if (isCommand && isAdmin) {
        const args = content.split(/\s+/);
        const cmd = args[0].toLowerCase();

        if (cmd === '/set-webhook') {
          let key = 'default';
          let url = '';
          if (args.length >= 3) {
            key = args[1];
            url = args[2];
          } else {
            url = args[1];
          }
          
          if (url && url.startsWith('http')) {
            config.webhooks = config.webhooks || {};
            config.webhooks[key] = url;
            if (key === 'default') config.webhookUrl = url; // backward compat
            saveConfig();
            await sendMsg(ctx, rawConvId, isGroupMsg, `✅ Đã cập nhật Webhook URL [${key}]:\n${url}`);
          } else {
            await sendMsg(ctx, rawConvId, isGroupMsg, `⚠️ Cú pháp: /set-webhook [key] <url>\nVí dụ: /set-webhook page https://...`);
          }
          return { handled: true };
        }

        if (cmd === '/post-start') {
          const inputChannel = content.substring('/post-start'.length).trim();
          let channelToSet = '';
          
          if (inputChannel) {
             const lower = inputChannel.toLowerCase();
             if (lower.includes('group') || lower === '1') channelToSet = 'Fb Group';
             else if (lower.includes('page') || lower === '2') channelToSet = 'Fb Page';
             else if (lower.includes('profile') || lower === '3') channelToSet = 'Fb Profile';
             else channelToSet = inputChannel;
          }

          if (channelToSet) {
            drafts.set(rawConvId, {
              state: 'WAITING_TYPE',
              channels: channelToSet,
              contentParts: [],
              files: [],
              localFiles: []
            });
            await sendMsg(ctx, rawConvId, isGroupMsg, `📝 Đã chọn kênh: ${channelToSet}.\n\nVui lòng chọn LOẠI bài đăng:\n1. Text with Media\n2. Text Only\n3. Text with Preview URL\n4. Text with Background\n5. Text with Background and Media\n(Gõ 1, 2, 3, 4 hoặc 5)`);
          } else {
            drafts.set(rawConvId, {
              state: 'WAITING_CHANNEL',
              channels: '',
              contentParts: [],
              files: [],
              localFiles: []
            });
            await sendMsg(ctx, rawConvId, isGroupMsg, `Vui lòng chọn kênh muốn đăng:\n1. Fb Group\n2. Fb Page\n3. Fb Profile\n(Gõ 1, 2, hoặc 3)`);
          }
          return { handled: true };
        }

        if (cmd === '/post-cancel' || cmd === '/post-cancle' || cmd === '/post-huy') {
          if (drafts.has(rawConvId)) {
            drafts.delete(rawConvId);
            await sendMsg(ctx, rawConvId, isGroupMsg, `🚫 Đã hủy bản thảo.`);
          } else {
            await sendMsg(ctx, rawConvId, isGroupMsg, `ℹ️ Không có bản thảo nào đang soạn.`);
          }
          return { handled: true };
        }

        if (cmd === '/post-send') {
          const key = args[1] || 'default';
          const draft = drafts.get(rawConvId);
          if (!draft) {
            await sendMsg(ctx, rawConvId, isGroupMsg, `⚠️ Không có bản thảo nào đang soạn. Gõ /post-start để bắt đầu.`);
            return { handled: true };
          }

          config.webhooks = config.webhooks || {};
          let webhook = config.webhooks[key];
          if (!webhook && key === 'default') webhook = config.webhookUrl;

          if (!webhook) {
            await sendMsg(ctx, rawConvId, isGroupMsg, `⚠️ N8N Webhook URL cho [${key}] chưa được thiết lập.\nHãy gửi lệnh: /set-webhook ${key !== 'default' ? key + ' ' : ''}<URL_CUA_BAN>`);
            return { handled: true };
          }

          if (draft.contentParts.length === 0 && draft.files.length === 0) {
            await sendMsg(ctx, rawConvId, isGroupMsg, `⚠️ Bản thảo trống. Hãy gửi nội dung hoặc hình ảnh trước khi đăng.`);
            return { handled: true };
          }

          draft.sendKey = key;
          draft.webhookTarget = webhook;
          draft.state = 'WAITING_TIME';
          
          await sendMsg(ctx, rawConvId, isGroupMsg, `🕒 Bạn muốn đăng khi nào?\n1. Đăng ngay\n2. Hẹn giờ đăng (nhập thời gian, vd: "14:30 15/05/2026" hoặc "14:30")\n\n(Nhập 1 để đăng ngay, hoặc nhập thời gian để hẹn giờ)`);
          return { handled: true };
        }

        if (cmd === '/post-status') {
           const draft = drafts.get(rawConvId);
           if (!draft) {
             await sendMsg(ctx, rawConvId, isGroupMsg, `ℹ️ Không có bản thảo nào đang soạn.`);
           } else {
             await sendMsg(ctx, rawConvId, isGroupMsg,
               `📊 Trạng thái bản thảo:\n` +
               `Kênh: ${draft.channels}\n` +
               `Nội dung: ${draft.contentParts.length} đoạn\n` +
               `Hình ảnh: ${draft.files.length} file`
             );
           }
           return { handled: true };
        }

        // /post-list: xem danh sách ngày đã lưu
        if (cmd === '/post-list') {
          try {
            const contentRoot = path.join(__dirname, 'content');
            if (!fs.existsSync(contentRoot)) {
              await sendMsg(ctx, rawConvId, isGroupMsg, `📁 Chưa có content nào được lưu.`);
            } else {
              const dirs = fs.readdirSync(contentRoot).filter(d =>
                fs.statSync(path.join(contentRoot, d)).isDirectory()
              ).sort().reverse().slice(0, 10);

              if (dirs.length === 0) {
                await sendMsg(ctx, rawConvId, isGroupMsg, `📁 Chưa có content nào được lưu.`);
              } else {
                const lines = dirs.map(d => {
                  const files = fs.readdirSync(path.join(contentRoot, d));
                  const imgCount = files.filter(f => /\.(jpg|png|gif|webp)$/i.test(f)).length;
                  const draftCount = files.filter(f => f.endsWith('.json')).length;
                  return `📅 ${d}: ${imgCount} ảnh, ${draftCount} bài`;
                });
                await sendMsg(ctx, rawConvId, isGroupMsg, `📂 Content đã lưu (10 ngày gần nhất):\n${lines.join('\n')}`);
              }
            }
          } catch(e) {
            await sendMsg(ctx, rawConvId, isGroupMsg, `❌ Lỗi đọc thư mục: ${e.message}`);
          }
          return { handled: true };
        }
      }

      // Accumulate drafting content
      if (drafts.has(rawConvId) && isAdmin) {
        const draft = drafts.get(rawConvId);

        if (draft.state === 'WAITING_CHANNEL') {
          const channelInput = content.trim();
          let channelToSet = '';
          if (channelInput === '1' || channelInput.toLowerCase() === 'fb group') channelToSet = 'Fb Group';
          else if (channelInput === '2' || channelInput.toLowerCase() === 'fb page') channelToSet = 'Fb Page';
          else if (channelInput === '3' || channelInput.toLowerCase() === 'fb profile') channelToSet = 'Fb Profile';
          
          if (channelToSet) {
            draft.state = 'WAITING_TYPE';
            draft.channels = channelToSet;
            await sendMsg(ctx, rawConvId, isGroupMsg, `📝 Đã chọn kênh: ${channelToSet}.\n\nVui lòng chọn LOẠI bài đăng:\n1. Text with Media\n2. Text Only\n3. Text with Preview URL\n4. Text with Background\n5. Text with Background and Media\n(Gõ 1, 2, 3, 4 hoặc 5. Gõ /post-cancel để hủy)`);
          } else {
            await sendMsg(ctx, rawConvId, isGroupMsg, `⚠️ Lựa chọn không hợp lệ.\nVui lòng chọn kênh muốn đăng:\n1. Fb Group\n2. Fb Page\n3. Fb Profile\n(Gõ 1, 2, hoặc 3. Gõ /post-cancel để hủy)`);
          }
          return { handled: true };
        }

        if (draft.state === 'WAITING_TYPE') {
          const typeInput = content.trim();
          let typeToSet = '';
          if (typeInput === '1') typeToSet = 'Text with Media';
          else if (typeInput === '2') typeToSet = 'Text Only';
          else if (typeInput === '3') typeToSet = 'Text with Preview URL';
          else if (typeInput === '4') typeToSet = 'Text with Background';
          else if (typeInput === '5') typeToSet = 'Text with Background and Media';
          else {
            const lower = typeInput.toLowerCase();
            if (lower.includes('only')) typeToSet = 'Text Only';
            else if (lower.includes('preview')) typeToSet = 'Text with Preview URL';
            else if (lower.includes('background') && lower.includes('media')) typeToSet = 'Text with Background and Media';
            else if (lower.includes('background')) typeToSet = 'Text with Background';
            else if (lower.includes('media')) typeToSet = 'Text with Media';
          }

          if (typeToSet) {
            draft.state = 'DRAFTING';
            draft.postType = typeToSet;
            await sendMsg(ctx, rawConvId, isGroupMsg, `📝 Đã chọn loại: ${typeToSet}.\nHãy gửi nội dung và hình ảnh (có thể gửi nhiều lần).\nGõ /post-send [key] để đăng, /post-cancel để hủy.`);
          } else {
            await sendMsg(ctx, rawConvId, isGroupMsg, `⚠️ Lựa chọn không hợp lệ.\nVui lòng chọn loại bài đăng:\n1. Text with Media\n2. Text Only\n3. Text with Preview URL\n4. Text with Background\n5. Text with Background and Media\n(Gõ 1, 2, 3, 4 hoặc 5. Gõ /post-cancel để hủy)`);
          }
          return { handled: true };
        }

        if (draft.state === 'WAITING_TIME') {
           const timeInput = content.trim();
           if (timeInput === '1' || timeInput.toLowerCase() === 'đăng ngay' || timeInput.toLowerCase() === 'dang ngay') {
              draft.scheduleTime = '';
              draft.state = 'SENDING';
              await executePostSend(draft, draft.webhookTarget, rawConvId, isGroupMsg, ctx);
           } else {
              const targetTime = parseScheduleTime(timeInput);
              if (!targetTime) {
                 await sendMsg(ctx, rawConvId, isGroupMsg, `⚠️ Định dạng thời gian không hợp lệ.\nVui lòng nhập "HH:mm" hoặc "HH:mm DD/MM/YYYY"\n(VD: 14:30 hoặc 14:30 15/05/2026).\nHoặc nhập 1 để đăng ngay.`);
                 return { handled: true };
              }
              
              const delay = targetTime.getTime() - Date.now();
              if (delay <= 0) {
                 await sendMsg(ctx, rawConvId, isGroupMsg, `⚠️ Thời gian đã qua. Vui lòng chọn thời gian trong tương lai.`);
                 return { handled: true };
              }
              if (delay > 2147483647) {
                 await sendMsg(ctx, rawConvId, isGroupMsg, `⚠️ Thời gian hẹn quá xa (tối đa 24 ngày). Vui lòng chọn thời gian gần hơn.`);
                 return { handled: true };
              }

              draft.scheduleTime = targetTime.toLocaleString('vi-VN');
              draft.state = 'SCHEDULED';
              
              await sendMsg(ctx, rawConvId, isGroupMsg, `✅ Đã lên lịch đăng lúc: ${draft.scheduleTime}.\nHệ thống sẽ tự động đăng vào lúc đó.`);
              
              setTimeout(() => {
                 executePostSend(draft, draft.webhookTarget, rawConvId, isGroupMsg, ctx).catch(console.error);
              }, delay);

              drafts.delete(rawConvId);
           }
           return { handled: true };
        }

        if (draft.state !== 'DRAFTING') {
           return { handled: true };
        }

        let addedSomething = false;

        // 1. Check attachments (Zalo native)
        const attachments = event.attachments || event.metadata?.attachments || event.raw?.attachments || [];
        if (Array.isArray(attachments)) {
          attachments.forEach(att => {
            if (att.url && (
              att.type === 'image' ||
              att.type === 'photo' ||
              att.type === 'video' ||
              att.url.match(/\.(jpeg|jpg|gif|png|webp|mp4)/i) ||
              att.url.includes('zaloapp.com') ||
              att.url.includes('zdn.vn') ||
              att.url.includes('zadn.vn')
            )) {
              draft.files.push(att.url);
              addedSomething = true;
            }
          });
        }

        // 2. Check markdown images/videos and raw Zalo media links
        if (content) {
          const regex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
          let match;
          while ((match = regex.exec(content)) !== null) {
            draft.files.push(match[1]);
            addedSomething = true;
          }

          let textOnly = content.replace(regex, '').trim();

          // Lọc tiếp các link media thô (do Zalo tự chuyển thành text)
          const rawImgRegex = /(https?:\/\/[^\s]+(?:zaloapp\.com|zdn\.vn|zadn\.vn)[^\s]*|https?:\/\/[^\s]+\.(?:jpeg|jpg|gif|png|webp|mp4)(?:\?[^\s]*)?)/gi;
          let rawMatch;
          while ((rawMatch = rawImgRegex.exec(textOnly)) !== null) {
            draft.files.push(rawMatch[1]);
            addedSomething = true;
          }

          // Xóa các link vừa bắt được ra khỏi nội dung text
          textOnly = textOnly.replace(rawImgRegex, '').trim();

          if (textOnly) {
            draft.contentParts.push(textOnly);
            addedSomething = true;
          }
        }

        if (addedSomething) {
          await sendMsg(ctx, rawConvId, isGroupMsg, `📎 Đã cập nhật bản thảo. Hiện có: ${draft.contentParts.length} đoạn text, ${draft.files.length} hình ảnh.`);
        }

        return { handled: true };
      }
    }, { priority: 350 });
  },

  tools: [
    {
      name: 'create_facebook_post',
      description: 'Tạo bản ghi mới trên Google Sheet để đăng lên Facebook qua hệ thống n8n.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Nội dung bài viết' },
          channels: { type: 'string', description: 'Kênh đăng bài, ví dụ: Fb, Threads.' },
          files: { type: 'string', description: 'Danh sách link URL hình ảnh cách nhau bằng dấu phẩy.' }
        },
        required: ['content']
      },
      execute: async (args, context) => {
        let config = { webhookUrl: '' };
        try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch(e) {}

        const n8nUrl = config.webhookUrl || 'http://host.docker.internal:5678/webhook/luna-post-fb';

        // --- Convert Zalo URLs → Telegraph CDN ---
        async function _download(url) {
          try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://zalo.me/' } });
            if (!res.ok) return null;
            const ct = res.headers.get('content-type') || '';
            let ext = '.jpg';
            if (ct.includes('png')) ext = '.png';
            else if (ct.includes('gif')) ext = '.gif';
            else if (ct.includes('webp')) ext = '.webp';
            else if (ct.includes('mp4')) ext = '.mp4';
            else if (url.includes('.mp4')) ext = '.mp4';

            const tmp = path.join(__dirname, `_tmp_${Date.now()}${ext}`);
            fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
            return { tmp, ext };
          } catch { return null; }
        }
        async function _telegraph(filePath, ext) {
          try {
            const buf = fs.readFileSync(filePath);
            const mime = { '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4' }[ext] || 'image/jpeg';
            const boundary = `----Boundary${Date.now()}`;
            const body = Buffer.concat([
              Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="media${ext}"\r\nContent-Type: ${mime}\r\n\r\n`),
              buf,
              Buffer.from(`\r\n--${boundary}--\r\n`)
            ]);
            const res = await fetch('https://telegra.ph/upload', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
            const data = await res.json();
            return Array.isArray(data) && data[0]?.src ? `https://telegra.ph${data[0].src}` : null;
          } catch { return null; }
        }

        let files = args.files || '';
        // Extract from context if no files
        if (!files && context?.session?.messages) {
          const urls = [];
          for (const msg of context.session.messages.slice(-5)) {
            if (Array.isArray(msg.attachments)) msg.attachments.forEach(a => { if (a.url && (a.type === 'image' || a.url.includes('zdn.vn'))) urls.push(a.url); });
            if (msg.content) { const r = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g; let m; while ((m = r.exec(msg.content)) !== null) urls.push(m[1]); }
          }
          if (urls.length) files = [...new Set(urls)].join(',');
        }

        // Convert each URL to Telegraph if it's a Zalo CDN link
        if (files) {
          const rawUrls = files.split(',').map(u => u.trim()).filter(Boolean);
          const publicUrls = [];
          for (const url of rawUrls) {
            if (url.includes('zdn.vn') || url.includes('zaloapp.com') || url.includes('zadn.vn')) {
              const dl = await _download(url);
              if (dl) {
                const pub = await _telegraph(dl.tmp, dl.ext);
                try { fs.unlinkSync(dl.tmp); } catch {}
                publicUrls.push(pub || url);
              } else {
                publicUrls.push(url);
              }
            } else {
              publicUrls.push(url);
            }
          }
          files = publicUrls.join(',');
        }

        args.files = files;
        args.channels = args.channels || 'Fb';

        try {
          const res = await fetch(n8nUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args)
          });
          const text = await res.text();
          if (res.ok) {
            return { success: true, message: 'Đã gửi bài viết sang n8n thành công.', response: text };
          } else {
            return { success: false, error: 'HTTP ' + res.status, details: text };
          }
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
    }
  ]
});

export default plugin;
