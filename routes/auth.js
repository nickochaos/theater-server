// routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();

const saltRounds = 10; // Сложность хеширования

// POST /api/auth/register - Регистрация нового пользователя
router.post('/register', async (req, res) => {
  const { username, name, surname, email, phone, password, role } = req.body;

  // Валидация входных данных
  if (!username || !name || !surname || !email || !password) {
    return res.status(400).json({ error: 'Требуются username, name, surname, email, password' });
  }
  // Дополнительная валидация (длина пароля, формат email и т.д.) может быть здесь

  try {
    // 1. Проверка, существует ли пользователь с таким username или email
    const existingUser = await db.query(
        'SELECT id FROM users WHERE username = $1 OR email = $2',
        [username, email]
    );
    if (existingUser.rows.length > 0) {
        // Проверяем, что именно совпало
        const checkUsername = await db.query('SELECT id FROM users WHERE username = $1', [username]);
        if (checkUsername.rows.length > 0) {
             return res.status(409).json({ error: `Имя пользователя '${username}' уже занято.` });
        }
        const checkEmail = await db.query('SELECT id FROM users WHERE email = $1', [email]);
         if (checkEmail.rows.length > 0) {
            return res.status(409).json({ error: `Email '${email}' уже зарегистрирован.` });
        }
       // Общая ошибка на всякий случай
       return res.status(409).json({ error: 'Имя пользователя или email уже существуют.' });
    }

    // 2. Хеширование пароля
    const password_hash = await bcrypt.hash(password, saltRounds);

    // 3. Сохранение пользователя в БД
    const sql = `
      INSERT INTO users (username, name, surname, email, phone, password_hash, role)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, username, name, surname, email, phone, role`; // Не возвращаем хеш

    const newUser = await db.query(sql, [
      username, name, surname, email, phone || null,
      password_hash, // Сохраняем хеш
      role === 'admin' ? 'customer' : (role || 'customer') // Запрещаем регистрацию админов напрямую
    ]);

    res.status(201).json({
        message: 'Пользователь успешно зарегистрирован',
        user: newUser.rows[0]
    });

  } catch (err) {
    console.error('Ошибка при регистрации пользователя:', err);
    // Обработка других возможных ошибок БД (хотя unique уже проверили)
     if (err.code === '23505') {
       return res.status(409).json({ error: 'Конфликт данных (возможно, имя пользователя или email).' });
    }
    res.status(500).json({ error: 'Внутренняя ошибка сервера при регистрации' });
  }
});

// POST /api/auth/login - Вход пользователя
router.post('/login', async (req, res) => {
    const { login, password } = req.body; // login может быть username или email

    if (!login || !password) {
        return res.status(400).json({ error: 'Требуется имя пользователя/email и пароль' });
    }

    try {
        // 1. Найти пользователя по username или email
        const userResult = await db.query(
            'SELECT id, username, email, role, password_hash FROM users WHERE username = $1 OR email = $1',
            [login]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Неверные учетные данные' }); // Пользователь не найден
        }

        const user = userResult.rows[0];

        // 2. Сравнить предоставленный пароль с хешем в БД
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: 'Неверные учетные данные' }); // Пароль не совпадает
        }

        // 3. Пароль совпал - генерируем JWT
        const payload = {
            userId: user.id,
            username: user.username,
            role: user.role
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '1h' } // Используем значение из .env или дефолт
        );

        // Отправляем токен клиенту
        res.json({
            message: 'Вход выполнен успешно',
            token: token,
            user: { // Отправляем некоторую инфу о пользователе (без хеша!)
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });

    } catch (err) {
        console.error('Ошибка при входе пользователя:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера при входе' });
    }
});


module.exports = router;
