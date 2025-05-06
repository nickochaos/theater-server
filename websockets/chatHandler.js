// websockets/chatHandler.js
const db = require('../db');
const jwt = require('jsonwebtoken');

// Простая структура для хранения онлайн пользователей/админов и их сокетов
// В реальном приложении лучше использовать Redis или другую внешнюю систему для масштабирования
const onlineUsers = new Map(); // userId -> socketId
const onlineAdmins = new Map(); // adminId -> socketId

module.exports = (io) => {

    // Middleware для аутентификации по токену при подключении к сокету
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token; // Ожидаем токен в auth объекте при подключении
        if (!token) {
            return next(new Error('Authentication error: Token not provided'));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            // Находим пользователя (можно выбрать меньше полей)
            const userQuery = await db.query('SELECT id, username, role FROM users WHERE id = $1', [decoded.userId]);
            if (userQuery.rows.length === 0) {
                return next(new Error('Authentication error: User not found'));
            }
            socket.user = userQuery.rows[0]; // Сохраняем пользователя в объекте сокета
            next();
        } catch (err) {
            console.error("Socket Auth Error:", err.message);
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id}, User: ${socket.user.username} (Role: ${socket.user.role})`);

        // --- Регистрация онлайн статуса и комнат ---
        if (socket.user.role === 'admin') {
            onlineAdmins.set(socket.user.id, socket.id);
            socket.join('admins'); // Все админы в одной комнате
             console.log(`Admin ${socket.user.username} joined 'admins' room.`);
        } else {
            onlineUsers.set(socket.user.id, socket.id);
            socket.join(`user_${socket.user.id}`); // Каждый пользователь в своей комнате
             console.log(`User ${socket.user.username} joined 'user_${socket.user.id}' room.`);
        }
        // Оповестить админов о новом подключении пользователя?
        // io.to('admins').emit('userConnected', { userId: socket.user.id, username: socket.user.username });


        // --- Обработка отправки сообщения ---
        socket.on('sendMessage', async (data) => {
            const { text, recipientId } = data; // recipientId нужен, когда админ отвечает конкретному пользователю
            const sender = socket.user;

            if (!text || text.trim() === '') {
                return; // Не отправлять пустые сообщения
            }

            let receiverId = null;
            let targetRoom = null;
            let saveReceiverId = null;

            if (sender.role === 'customer') {
                targetRoom = 'admins'; // Сообщение от клиента идет всем админам
                saveReceiverId = null; // Сообщение для "поддержки" в целом
            } else if (sender.role === 'admin' && recipientId) {
                targetRoom = `user_${recipientId}`; // Админ отвечает конкретному юзеру
                receiverId = recipientId;
                saveReceiverId = recipientId; // Сохраняем, кому адресовано
            } else {
                console.warn(`Invalid sendMessage attempt by ${sender.username} (Role: ${sender.role}) without recipientId.`);
                return; // Невалидное сообщение (админ без получателя)
            }

            try {
                // 1. Сохранить сообщение в БД
                const insertQuery = `
                    INSERT INTO chat_messages (sender_id, receiver_id, message_text, sender_role)
                    VALUES ($1, $2, $3, $4) RETURNING id, sent_at`;
                const result = await db.query(insertQuery, [sender.id, saveReceiverId, text.trim(), sender.role]);
                const newMessage = {
                    id: result.rows[0].id,
                    text: text.trim(),
                    senderId: sender.id,
                    senderUsername: sender.username, // Добавляем имя для удобства клиента
                    senderRole: sender.role,
                    sentAt: result.rows[0].sent_at,
                    recipientId: receiverId // Для клиента - знать, кому ответил админ
                };

                // 2. Отправить сообщение получателю(ям) через WebSocket
                console.log(`Emitting 'newMessage' to room ${targetRoom || socket.id}:`, newMessage);
                if (targetRoom) {
                    io.to(targetRoom).emit('newMessage', newMessage);
                }
                // Можно также отправить подтверждение обратно отправителю
                // socket.emit('messageSentConfirmation', { tempId: data.tempId, message: newMessage });

            } catch (error) {
                console.error(`Error saving/sending chat message from ${sender.username}:`, error);
                // Отправить ошибку обратно отправителю?
                socket.emit('sendMessageError', { error: 'Не удалось отправить сообщение' });
            }
        });

        // --- Обработка отключения ---
        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id}, User: ${socket.user.username}`);
            if (socket.user.role === 'admin') {
                onlineAdmins.delete(socket.user.id);
            } else {
                onlineUsers.delete(socket.user.id);
            }
             // Оповестить админов об отключении пользователя?
            // io.to('admins').emit('userDisconnected', { userId: socket.user.id });
        });

        // --- Другие возможные события ---
        // socket.on('markAsRead', (data) => { /* ... обновление is_read в БД ... */ });
        // socket.on('typing', (data) => { io.to(targetRoom).emit('userTyping', { userId: sender.id }); });
    });
};
