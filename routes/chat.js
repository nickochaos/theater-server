// routes/chat.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');

// GET /api/chat/my-history - История для текущего пользователя
router.get('/my-history', protect, async (req, res) => {
    const userId = req.user.id;
    const { limit = 50, beforeMessageId } = req.query;
    try {
        let sql = `
            SELECT cm.id, cm.sender_id, cm.receiver_id, cm.message_text as text, cm.sent_at as "sentAt", cm.is_read as "isRead", cm.sender_role as "senderRole",
                   u_sender.username as "senderUsername" -- Добавляем имя отправителя
            FROM chat_messages cm
            LEFT JOIN users u_sender ON cm.sender_id = u_sender.id
            WHERE (cm.sender_id = $1 AND cm.sender_role = 'customer') OR (cm.receiver_id = $1 AND cm.sender_role = 'admin')`;
        const params = [userId];

        if (beforeMessageId && /^\d+$/.test(beforeMessageId)) {
            sql += ` AND cm.id < $${params.length + 1}`;
            params.push(parseInt(beforeMessageId, 10));
        }

        sql += ` ORDER BY cm.sent_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit, 10));

        const { rows } = await db.query(sql, params);

        // Помечаем сообщения от админа как прочитанные (можно сделать асинхронно)
        db.query("UPDATE chat_messages SET is_read = true WHERE receiver_id = $1 AND sender_role = 'admin' AND is_read = false", [userId])
          .catch(err => console.error("Ошибка обновления статуса прочтения:", err));

        res.json(rows.reverse()); // Отдаем в хронологическом порядке
    } catch (err) {
        console.error(`Ошибка получения истории чата для пользователя ${userId}:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// GET /api/chat/admin/history?userId=X - История для админа по ID пользователя
router.get('/admin/history', protect, isAdmin, async (req, res) => {
    const { userId, limit = 50, beforeMessageId } = req.query;
    if (!userId || !/^\d+$/.test(userId)) {
        return res.status(400).json({ error: 'Требуется корректный userId' });
    }
    const targetUserId = parseInt(userId, 10);

     try {
        let sql = `
            SELECT cm.id, cm.sender_id, cm.receiver_id, cm.message_text as text, cm.sent_at as "sentAt", cm.is_read as "isRead", cm.sender_role as "senderRole",
                   u_sender.username as "senderUsername"
            FROM chat_messages cm
            LEFT JOIN users u_sender ON cm.sender_id = u_sender.id
            WHERE (cm.sender_id = $1 AND cm.sender_role = 'customer') OR (cm.receiver_id = $1 AND cm.sender_role = 'admin')`; // История конкретного пользователя
        const params = [targetUserId];

        if (beforeMessageId && /^\d+$/.test(beforeMessageId)) {
            sql += ` AND cm.id < $${params.length + 1}`;
            params.push(parseInt(beforeMessageId, 10));
        }

        sql += ` ORDER BY cm.sent_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit, 10));

        const { rows } = await db.query(sql, params);

         // Помечаем сообщения от клиента как прочитанные админом
         db.query("UPDATE chat_messages SET is_read = true WHERE sender_id = $1 AND sender_role = 'customer' AND is_read = false", [targetUserId])
           .catch(err => console.error("Ошибка обновления статуса прочтения админом:", err));

        res.json(rows.reverse());
    } catch (err) {
        console.error(`Ошибка получения истории чата админом для пользователя ${userId}:`, err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// GET /api/chat/admin/active - Активные чаты для админа
router.get('/admin/active', protect, isAdmin, async (req, res) => {
     try {
        const sql = `
            SELECT DISTINCT ON (u.id) -- Получаем только одну строку для каждого пользователя
                 u.id, u.username, u.name, u.surname,
                 last_msg.message_text as "lastMessageText",
                 last_msg.sent_at as "lastMessageTime",
                 unread_counts.unread_count
            FROM users u
            JOIN chat_messages last_msg ON (last_msg.sender_id = u.id OR last_msg.receiver_id = u.id) -- Последнее сообщение в диалоге с юзером
            LEFT JOIN ( -- Подсчет непрочитанных сообщений от клиента
                SELECT sender_id, COUNT(*) as unread_count
                FROM chat_messages
                WHERE sender_role = 'customer' AND is_read = false
                GROUP BY sender_id
            ) AS unread_counts ON u.id = unread_counts.sender_id
            WHERE u.role = 'customer' -- Только чаты с клиентами
              AND last_msg.id = ( -- Находим ID последнего сообщения в диалоге
                    SELECT MAX(id)
                    FROM chat_messages
                    WHERE (sender_id = u.id AND sender_role = 'customer') OR (receiver_id = u.id AND sender_role = 'admin')
                  )
            ORDER BY u.id, last_msg.sent_at DESC -- Сортировка для DISTINCT ON + общая по времени
            `;
         // Примечание: Этот SQL может быть не самым оптимальным для больших объемов.
         // Возможно, потребуется денормализация или другой подход.

        const { rows } = await db.query(sql);
        // Фильтруем, оставляя только чаты с непрочитанными сообщениями или недавние
        const activeChats = rows.filter(chat => chat.unread_count > 0); // Пример: только с непрочитанными
        // Или можно сортировать по unread_count DESC, lastMessageTime DESC

        res.json(activeChats); // Возвращаем список активных чатов
    } catch (err) {
        console.error('Ошибка получения активных чатов:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;
