// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const db = require('../db'); // Понадобится, если нужно проверять пользователя по ID из токена

const protect = async (req, res, next) => {
  let token;

  // Ищем токен в заголовке Authorization: Bearer <token>
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Извлекаем токен
      token = req.headers.authorization.split(' ')[1];

      // Верифицируем токен с нашим секретным ключом
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Находим пользователя по ID из токена и добавляем его в объект запроса
      // Исключаем пароль из выборки!
      const userQuery = await db.query(
          'SELECT id, username, name, surname, email, phone, role FROM users WHERE id = $1',
          [decoded.userId] // Предполагаем, что в токен записан userId
      );

      if (userQuery.rows.length === 0) {
          return res.status(401).json({ error: 'Пользователь токена не найден' });
      }

      req.user = userQuery.rows[0]; // Добавляем объект user к запросу
      next(); // Переходим к следующему middleware или обработчику маршрута

    } catch (error) {
      console.error('Ошибка верификации токена:', error.message);
      // Обработка разных ошибок токена
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Недействительный токен' });
      }
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Срок действия токена истек' });
      }
      return res.status(401).json({ error: 'Не авторизован, ошибка токена' });
    }
  }

  if (!token) {
    res.status(401).json({ error: 'Не авторизован, токен отсутствует' });
  }
};

// Middleware для проверки роли администратора
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Доступ запрещен. Требуются права администратора.' });
    }
};


module.exports = { protect, isAdmin };
