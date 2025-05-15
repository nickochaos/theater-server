// websockets/chatHandler.js
const db = require('../db');
const jwt = require('jsonwebtoken');


const onlineUsers = new Map(); // userId -> socketId
const onlineAdmins = new Map(); // adminId -> socketId

module.exports = (io) => {

  
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token; 
        if (!token) {
            return next(new Error('Authentication error: Token not provided'));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const userQuery = await db.query('SELECT id, username, role FROM users WHERE id = $1', [decoded.userId]);
            if (userQuery.rows.length === 0) {
                return next(new Error('Authentication error: User not found'));
            }
            socket.user = userQuery.rows[0]; 
            next();
        } catch (err) {
            console.error("Socket Auth Error:", err.message);
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id}, User: ${socket.user.username} (Role: ${socket.user.role})`);

       
        if (socket.user.role === 'admin') {
            onlineAdmins.set(socket.user.id, socket.id);
            socket.join('admins'); 
             console.log(`Admin ${socket.user.username} joined 'admins' room.`);
        } else {
            onlineUsers.set(socket.user.id, socket.id);
            socket.join(`user_${socket.user.id}`);
             console.log(`User ${socket.user.username} joined 'user_${socket.user.id}' room.`);
        }
       

       
        socket.on('sendMessage', async (data) => {
            console.log(`Сервер получил событие sendMessage от ${socket.user.username}:`, data);
            const { text, recipientId } = data; 
            const sender = socket.user;

            if (!text || text.trim() === '') {
                console.log('Получено пустое сообщение.');
                return; 
            }

            let receiverId = null;
            let targetRoom = null;
            let saveReceiverId = null;

            if (sender.role === 'customer') {
                targetRoom = 'admins'; 
                saveReceiverId = null; 
                console.log(`Сообщение от клиента "${sender.username}" для комнаты админов.`);
            } else if (sender.role === 'admin' && recipientId) {
                targetRoom = `user_${recipientId}`; 
                receiverId = recipientId;
                saveReceiverId = recipientId; 
                console.log(`Сообщение от админа "${sender.username}" для пользователя ID ${recipientId}.`);
            } else {
                console.warn(`Invalid sendMessage attempt by ${sender.username} (Role: ${sender.role}) without recipientId.`);
                return; 
            }

            try {
                console.log(`Попытка сохранить сообщение в БД: senderId=${sender.id}, receiverId=${saveReceiverId}, text=${text.trim()}, senderRole=${sender.role}`);
                const insertQuery = `
                    INSERT INTO chat_messages (sender_id, receiver_id, message_text, sender_role)
                    VALUES ($1, $2, $3, $4) RETURNING id, sent_at`;
                const result = await db.query(insertQuery, [sender.id, saveReceiverId, text.trim(), sender.role]);
                console.log('Сообщение успешно сохранено в БД с ID:', result.rows[0].id);
                const newMessage = {
                    id: result.rows[0].id,
                    text: text.trim(),
                    senderId: sender.id,
                    senderUsername: sender.username, 
                    senderRole: sender.role,
                    sentAt: result.rows[0].sent_at,
                    recipientId: receiverId 
                };

                
                console.log(`Попытка отправить 'newMessage' в комнату ${targetRoom} и сокет отправителя ${socket.id}:`, newMessage);
                if (targetRoom) {
                    io.to(targetRoom).emit('newMessage', newMessage);
                    console.log(`Событие newMessage успешно отправлено в комнату ${targetRoom}.`);
                }  else {
                    console.warn('Target room не определена для отправки newMessage.'); // <--- Лог
                }
                socket.emit('newMessage', newMessage);
            } catch (error) {
                console.error(`Error saving/sending chat message from ${sender.username}:`, error);
                socket.emit('sendMessageError', { error: 'Не удалось отправить сообщение' });
            }
        });


        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id}, User: ${socket.user.username}`);
            if (socket.user.role === 'admin') {
                onlineAdmins.delete(socket.user.id);
            } else {
                onlineUsers.delete(socket.user.id);
            }
        });
    });
};
